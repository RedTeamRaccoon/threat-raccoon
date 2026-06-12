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
 * attachment's `data` and sections 2..N ride along in `pendingSections`. jszip
 * and emf-converter are loaded lazily so they stay out of the main bundle until
 * a DOCX is actually attached, mirroring the lazy pdf.js pattern.
 */

import { createSectionBuilder, toTextAttachment, CHUNK_BUDGET_BYTES } from './sectionedText.js';

// keep the longest image edge under the common vision-model sweet spot
const MAX_RENDER_DIM = 1568;
const JPEG_QUALITY = 0.85;
// images are the token-expensive part; text is cheap, so it keeps flowing long
// after images stop
const DEFAULT_MAX_IMAGES = 20;
// paragraphs per numbered block — the unit for section ranges
const PARAGRAPHS_PER_BLOCK = 25;
// icons/bullets: skip when both known dimensions are below this
const MIN_IMAGE_DIM = 100;
// a blank/failed EMF/WMF conversion tends to produce a tiny data URL
const MIN_VECTOR_DATA_URL_LENGTH = 2000;

let jszipPromise = null;
const loadJsZip = () => {
    if (!jszipPromise) {
        jszipPromise = import(/* webpackChunkName: "docx" */ 'jszip').then((m) => m.default || m);
    }
    return jszipPromise;
};

let emfPromise = null;
const loadEmfConverter = () => {
    if (!emfPromise) {
        emfPromise = import(/* webpackChunkName: "docx" */ 'emf-converter');
    }
    return emfPromise;
};

// media extension -> image media type for the formats we pass through directly
const RASTER_MEDIA_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
};

const extOf = (path) => {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
};

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

// load an image data URL into a canvas-measurable Image; resolves with the
// Image (with naturalWidth/Height) or rejects on error
const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
});

const dataUrlFromBase64 = (base64, mediaType) => `data:${mediaType};base64,${base64}`;

// downscale through a canvas to keep the longest edge under MAX_RENDER_DIM;
// returns { data, mediaType }
const downscale = (img, sourceExt) => {
    const scale = Math.min(1, MAX_RENDER_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    // PNG preserves diagram crispness; JPEG is smaller for photos
    if (sourceExt === 'png') {
        return { data: canvas.toDataURL('image/png'), mediaType: 'image/png' };
    }
    return { data: canvas.toDataURL('image/jpeg', JPEG_QUALITY), mediaType: 'image/jpeg' };
};

// rasterize an SVG (or any <img>-renderable source) to a PNG data URL
const rasterize = async (src) => {
    const img = await loadImage(src);
    const scale = Math.min(1, MAX_RENDER_DIM / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || MAX_RENDER_DIM) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || MAX_RENDER_DIM) * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
};

/**
 * Converts a single media file into an image part, or null when it cannot be
 * rendered (counts toward skippedImages). `arrayBuffer` is the raw media bytes;
 * `base64` is the same bytes base64-encoded (jszip provides both cheaply).
 * @returns {Promise<{ data: String, mediaType: String }|null>}
 */
const convertMedia = async (ext, base64, arrayBuffer) => {
    const rasterType = RASTER_MEDIA_TYPES[ext];
    if (rasterType) {
        const url = dataUrlFromBase64(base64, rasterType);
        let img;
        try {
            img = await loadImage(url);
        } catch (e) {
            // dimensions unknown: pass through rather than silently drop
            return { data: url, mediaType: rasterType };
        }
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w && h && w < MIN_IMAGE_DIM && h < MIN_IMAGE_DIM) {
            return null;
        }
        if ((w && w > MAX_RENDER_DIM) || (h && h > MAX_RENDER_DIM)) {
            return downscale(img, ext);
        }
        return { data: url, mediaType: rasterType };
    }
    if (ext === 'svg') {
        try {
            return { data: await rasterize(dataUrlFromBase64(base64, 'image/svg+xml')), mediaType: 'image/png' };
        } catch (e) {
            return null;
        }
    }
    if (ext === 'emf' || ext === 'wmf') {
        try {
            const converter = await loadEmfConverter();
            const fn = ext === 'emf' ? converter.convertEmfToDataUrl : converter.convertWmfToDataUrl;
            const data = await fn(arrayBuffer);
            // a blank/failed conversion tends to be a tiny data URL
            if (!data || data.length < MIN_VECTOR_DATA_URL_LENGTH) {
                return null;
            }
            return { data, mediaType: 'image/png' };
        } catch (e) {
            return null;
        }
    }
    // tiff and anything else: not renderable to a vision model here
    return null;
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
        const entry = zip.file(path);
        if (!entry) {
            continue;
        }
        const ext = extOf(path);
        const base64 = await entry.async('base64');
        let buffer = null;
        if (ext === 'emf' || ext === 'wmf') {
            const arr = await entry.async('uint8array');
            buffer = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
        }
        const converted = await convertMedia(ext, base64, buffer);
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
