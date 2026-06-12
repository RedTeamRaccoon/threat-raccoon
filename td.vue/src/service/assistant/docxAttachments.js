/**
 * @name docxAttachments
 * @description Converts an attached DOCX (OOXML) into assistant attachments: one
 * text attachment with the extracted text (headings and tables preserved as
 * markdown) plus one image per embedded figure so vision models can read
 * diagrams the text cannot express. DOCX is a ZIP: the prose lives in
 * word/document.xml, image relationships in word/_rels/document.xml.rels, and
 * the media bytes verbatim in word/media/. Long documents are CHUNKED rather
 * than truncated, mirroring pdfAttachments: paragraphs are grouped into numbered
 * "blocks" and packed into byte-budgeted sections; section 1 rides in the text
 * attachment's `data` and sections 2..N ride along in `pendingSections`. The
 * media conversion pipeline and lazy jszip loader live in the shared
 * ./ooxmlMedia.js module (also used by pptxAttachments).
 */

import { createSectionBuilder, toTextAttachment, CHUNK_BUDGET_BYTES } from './sectionedText.js';
import { loadJsZip, convertZipMedia } from './ooxmlMedia.js';

// images are the token-expensive part; text is cheap, so it keeps flowing long
// after images stop
const DEFAULT_MAX_IMAGES = 20;
// paragraphs per numbered block — the unit for section ranges
const PARAGRAPHS_PER_BLOCK = 25;

// XML namespaces vary in prefix; match on local name to stay robust
const localName = (node) => (node.localName || node.nodeName || '').replace(/^.*:/u, '');

const childrenByLocal = (node, name) => {
    const out = [];
    for (let i = 0; i < node.childNodes.length; i += 1) {
        const child = node.childNodes[i];
        if (child.nodeType === 1 && localName(child) === name) {
            out.push(child);
        }
    }
    return out;
};

const firstByLocal = (node, name) => childrenByLocal(node, name)[0] || null;

// attribute lookup ignoring namespace prefix (w:val, r:embed, xml:space, …)
const attrByLocal = (node, name) => {
    if (!node || !node.attributes) {
        return null;
    }
    for (let i = 0; i < node.attributes.length; i += 1) {
        const attr = node.attributes[i];
        if ((attr.localName || attr.name || '').replace(/^.*:/u, '') === name) {
            return attr.value;
        }
    }
    return null;
};

// recursively collect every descendant element with the given local name
const descendantsByLocal = (node, name, out = []) => {
    for (let i = 0; i < node.childNodes.length; i += 1) {
        const child = node.childNodes[i];
        if (child.nodeType === 1) {
            if (localName(child) === name) {
                out.push(child);
            }
            descendantsByLocal(child, name, out);
        }
    }
    return out;
};

const HEADING_RE = /^Heading([1-9])$/u;

// returns the markdown heading prefix ('# ', '## ', …) for a paragraph, or ''
const headingPrefix = (paragraph) => {
    const pPr = firstByLocal(paragraph, 'pPr');
    if (!pPr) {
        return '';
    }
    const pStyle = firstByLocal(pPr, 'pStyle');
    const val = pStyle && attrByLocal(pStyle, 'val');
    if (!val) {
        return '';
    }
    if (val === 'Title') {
        return '# ';
    }
    const match = HEADING_RE.exec(val);
    return match ? `${'#'.repeat(Number(match[1]))} ` : '';
};

// concatenate the <w:t> runs of a paragraph, preserving inner spaces
const paragraphText = (paragraph) => {
    const runs = descendantsByLocal(paragraph, 't');
    let text = '';
    for (const run of runs) {
        text += run.textContent || '';
    }
    return text;
};

// a table row's cells joined with ' | '
const rowText = (row) => childrenByLocal(row, 'tc')
    .map((cell) => childrenByLocal(cell, 'p').map(paragraphText).join(' ').trim())
    .join(' | ');

// walk <w:body> children in order, emitting one text line per non-empty
// paragraph / table row
const extractBody = (body) => {
    const lines = [];
    for (let i = 0; i < body.childNodes.length; i += 1) {
        const node = body.childNodes[i];
        if (node.nodeType !== 1) {
            continue;
        }
        const name = localName(node);
        if (name === 'p') {
            const text = paragraphText(node).trim();
            if (text) {
                lines.push(`${headingPrefix(node)}${text}`);
            }
        } else if (name === 'tbl') {
            for (const row of childrenByLocal(node, 'tr')) {
                const text = rowText(row);
                if (text.trim()) {
                    lines.push(text);
                }
            }
        }
    }
    return lines;
};

// parse word/_rels/document.xml.rels into { relId: target } (media targets only)
const parseRels = (xml) => {
    const map = {};
    if (!xml) {
        return map;
    }
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rels = doc.getElementsByTagName('*');
    for (let i = 0; i < rels.length; i += 1) {
        const node = rels[i];
        if (localName(node) === 'Relationship') {
            const id = attrByLocal(node, 'Id');
            const target = attrByLocal(node, 'Target');
            if (id && target) {
                // targets are relative to word/ (e.g. media/image1.png)
                map[id] = target.replace(/^\/+/u, '').replace(/^word\//u, '');
            }
        }
    }
    return map;
};

// ordered list of media paths referenced by <a:blip> in document order
const blipMediaPaths = (documentDoc, rels) => {
    const paths = [];
    const blips = documentDoc.getElementsByTagName('*');
    for (let i = 0; i < blips.length; i += 1) {
        const node = blips[i];
        if (localName(node) !== 'blip') {
            continue;
        }
        const relId = attrByLocal(node, 'embed') || attrByLocal(node, 'link');
        const target = relId && rels[relId];
        if (target) {
            paths.push(`word/${target.replace(/^word\//u, '')}`);
        }
    }
    return paths;
};

/**
 * Extracts a DOCX file into assistant attachments. The text of EVERY paragraph
 * block is extracted and split into byte-budgeted sections (capped — blocks
 * beyond the cap are genuinely truncated); every embedded figure is delivered as
 * an image, up to the image cap, at native quality (downscaled only when an edge
 * exceeds the vision-model sweet spot).
 * @param {File} file
 * @param {{ maxImages?: Number, chunkBudget?: Number }} [options]
 * @returns {Promise<{ attachments: Object[], sections: Number, pageCount: Number,
 *   truncated: Boolean, textPages: Number, imagePages: Number, skippedImages: Number }>}
 */
export const extractDocxAttachments = async (file, options = {}) => {
    const { maxImages = DEFAULT_MAX_IMAGES, chunkBudget = CHUNK_BUDGET_BYTES } = options;
    const name = file.name || 'document.docx';
    const arrayBuffer = await file.arrayBuffer();
    const JSZip = await loadJsZip();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // --- TEXT ---
    const documentXml = await zip.file('word/document.xml').async('string');
    const documentDoc = new DOMParser().parseFromString(documentXml, 'application/xml');
    const body = firstByLocal(documentDoc.documentElement, 'body') || documentDoc.documentElement;
    const lines = extractBody(body);

    // group consecutive paragraphs/rows into numbered blocks for section ranges
    const blocks = [];
    for (let i = 0; i < lines.length; i += PARAGRAPHS_PER_BLOCK) {
        blocks.push(lines.slice(i, i + PARAGRAPHS_PER_BLOCK).join('\n'));
    }

    const builder = createSectionBuilder({ chunkBudget });
    blocks.forEach((blockText, idx) => {
        const blockNumber = idx + 1;
        builder.add(blockNumber, `[Block ${blockNumber}]\n${blockText}`);
    });
    const { sections, total, truncated, lastUnit: textPages } = builder.finish();

    // --- IMAGES ---
    const relsFile = zip.file('word/_rels/document.xml.rels');
    const rels = parseRels(relsFile ? await relsFile.async('string') : '');

    // blip-referenced media in document order, then any unreferenced media
    // (headers/footers reference media from their own parts) so nothing is lost
    const ordered = [];
    const seen = new Set();
    const pushPath = (path) => {
        if (!seen.has(path)) {
            seen.add(path);
            ordered.push(path);
        }
    };
    blipMediaPaths(documentDoc, rels).forEach(pushPath);
    Object.keys(zip.files)
        .filter((path) => (/^word\/media\//u).test(path) && !zip.files[path].dir)
        .sort()
        .forEach(pushPath);

    const images = [];
    let skippedImages = 0;
    for (const path of ordered) {
        if (images.length >= maxImages) {
            break;
        }
        if (!zip.file(path)) {
            continue;
        }
        const converted = await convertZipMedia(zip, path);
        if (!converted) {
            skippedImages += 1;
            continue;
        }
        images.push({
            kind: 'image',
            mediaType: converted.mediaType,
            name: `${name} (figure ${images.length + 1})`,
            data: converted.data
        });
    }

    const imagePages = images.length;

    if (truncated && total) {
        sections[total - 1].text += `\n\n[Document truncated: text included for the first ${textPages}`
            + ` of ${blocks.length} paragraph blocks, figure images for the first ${imagePages}.`
            + ' Tell the user if you need the rest.]';
    }

    const textAttachment = toTextAttachment(sections, name);

    return {
        // every part carries group: <file name> so the composer renders the
        // whole DOCX as ONE chip instead of a chip per figure
        attachments: [
            textAttachment,
            ...images.map((image) => ({ ...image, group: name }))
        ],
        sections: total,
        pageCount: blocks.length,
        truncated,
        textPages,
        imagePages,
        skippedImages
    };
};

export default { extractDocxAttachments };
