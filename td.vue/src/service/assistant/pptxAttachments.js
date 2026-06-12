/**
 * @name pptxAttachments
 * @description Converts an attached PPTX (OOXML presentation) into assistant
 * attachments: one text attachment with each slide's text (title first, then
 * body shapes and tables) plus one image per embedded figure so vision models
 * can read diagrams the text cannot express. PPTX is a ZIP: slides live at
 * ppt/slides/slide{N}.xml, their display ORDER comes from ppt/presentation.xml's
 * <p:sldIdLst> resolved via ppt/_rels/presentation.xml.rels, image
 * relationships live per-slide at ppt/slides/_rels/slide{N}.xml.rels, and the
 * media bytes verbatim in ppt/media/. Long decks are CHUNKED rather than
 * truncated, mirroring docxAttachments: each slide is one numbered unit packed
 * into byte-budgeted sections so section ranges read as slide ranges. The media
 * conversion pipeline and lazy jszip loader live in the shared ./ooxmlMedia.js
 * module. KNOWN GAPS: notes slides (ppt/notesSlides/*) are skipped entirely, and
 * SmartArt (rendered from drawing XML, not <a:t>) is not extracted — same as the
 * docx module.
 */

import { createSectionBuilder, toTextAttachment, CHUNK_BUDGET_BYTES } from './sectionedText.js';
import { loadJsZip, convertZipMedia } from './ooxmlMedia.js';

// images are the token-expensive part; text is cheap, so it keeps flowing long
// after images stop
const DEFAULT_MAX_IMAGES = 20;

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

// attribute lookup ignoring namespace prefix (r:embed, r:id, type, …)
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

// a relationship reference (r:id / r:embed) — prefer the namespace-PREFIXED
// attribute because a <p:sldId> also carries a plain numeric `id` that would
// otherwise win the bare-local-name match against the r:id we actually want
const relRef = (node, name) => {
    if (!node || !node.attributes) {
        return null;
    }
    let fallback = null;
    for (let i = 0; i < node.attributes.length; i += 1) {
        const attr = node.attributes[i];
        const raw = attr.name || attr.localName || '';
        if ((raw.replace(/^.*:/u, '')) !== name) {
            continue;
        }
        if (raw.indexOf(':') >= 0) {
            return attr.value;
        }
        fallback = attr.value;
    }
    return fallback;
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

// concatenate the <a:t> runs of one <a:p> paragraph, preserving inner spaces
const paragraphText = (paragraph) => {
    const runs = descendantsByLocal(paragraph, 't');
    let text = '';
    for (const run of runs) {
        text += run.textContent || '';
    }
    return text;
};

// a shape's paragraphs joined with newlines (skipping blank ones)
const shapeText = (shape) => descendantsByLocal(shape, 'p')
    .map(paragraphText)
    .map((t) => t.trim())
    .filter((t) => t)
    .join('\n');

// true when a <p:sp> shape is the slide's title placeholder (title/ctrTitle)
const isTitleShape = (shape) => {
    const nvSpPr = firstByLocal(shape, 'nvSpPr');
    const nvPr = nvSpPr && firstByLocal(nvSpPr, 'nvPr');
    const ph = nvPr && firstByLocal(nvPr, 'ph');
    const type = ph && attrByLocal(ph, 'type');
    return type === 'title' || type === 'ctrTitle';
};

// a table row's cells joined with ' | '
const rowText = (row) => childrenByLocal(row, 'tc')
    .map((cell) => shapeText(cell).replace(/\n/gu, ' ').trim())
    .join(' | ');

// pull a table's rows out as pipe-joined lines
const tableLines = (tbl) => childrenByLocal(tbl, 'tr')
    .map(rowText)
    .filter((line) => line.trim());

/**
 * Extracts one slide's text: the title placeholder first (when identifiable),
 * then the remaining shapes and tables in document order. Returns '' for an
 * empty slide.
 * @param {Element} slideRoot the slide document element
 * @returns {String}
 */
const slideText = (slideRoot) => {
    const shapes = descendantsByLocal(slideRoot, 'sp');
    const titleParts = [];
    const bodyParts = [];
    for (const shape of shapes) {
        const text = shapeText(shape);
        if (!text) {
            continue;
        }
        if (isTitleShape(shape)) {
            titleParts.push(text);
        } else {
            bodyParts.push(text);
        }
    }
    const tableParts = descendantsByLocal(slideRoot, 'tbl')
        .map((tbl) => tableLines(tbl).join('\n'))
        .filter((t) => t);
    return [...titleParts, ...bodyParts, ...tableParts].join('\n');
};

// parse a *.rels part into { relId: target }
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
                map[id] = target;
            }
        }
    }
    return map;
};

// normalize a slide-relative media target ('../media/image1.png') into a full
// in-zip path ('ppt/media/image1.png'); slide rels live in ppt/slides/_rels/
const normalizeMediaTarget = (target) => {
    const cleaned = target.replace(/^\/+/u, '');
    // resolve a single leading '../' against the slide folder (ppt/slides/)
    if ((/^\.\.\//u).test(cleaned)) {
        return `ppt/${cleaned.replace(/^\.\.\//u, '')}`;
    }
    if ((/^ppt\//u).test(cleaned)) {
        return cleaned;
    }
    // bare 'media/..' or 'slides/media/..': anchor under ppt/slides/
    return `ppt/slides/${cleaned}`;
};

// ordered list of media paths referenced by <a:blip>/<p:pic> in slide order
const slideBlipMediaPaths = (slideRoot, rels) => {
    const paths = [];
    const blips = descendantsByLocal(slideRoot, 'blip');
    for (const blip of blips) {
        const relId = relRef(blip, 'embed') || relRef(blip, 'link');
        const target = relId && rels[relId];
        if (target) {
            paths.push(normalizeMediaTarget(target));
        }
    }
    return paths;
};

// numeric suffix of a slide file name (ppt/slides/slide12.xml -> 12)
const slideNumber = (path) => {
    const match = (/slide(\d+)\.xml$/u).exec(path);
    return match ? Number(match[1]) : 0;
};

/**
 * Resolves the ORDERED list of slide file paths. Preferred order comes from
 * presentation.xml's <p:sldIdLst> (each <p:sldId r:id> resolved through the
 * presentation rels to a ppt/slides/slide{N}.xml target). Falls back to a
 * numeric sort of the slide file names when that resolution yields nothing.
 * @param {Object} zip a loaded JSZip instance
 * @returns {Promise<String[]>}
 */
const resolveSlideOrder = async (zip) => {
    const allSlides = Object.keys(zip.files)
        .filter((path) => (/^ppt\/slides\/slide\d+\.xml$/u).test(path) && !zip.files[path].dir);
    const numericOrder = allSlides.slice().sort((a, b) => slideNumber(a) - slideNumber(b));

    const presFile = zip.file('ppt/presentation.xml');
    const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
    if (!presFile || !relsFile) {
        return numericOrder;
    }
    const rels = parseRels(await relsFile.async('string'));
    const presDoc = new DOMParser().parseFromString(await presFile.async('string'), 'application/xml');
    const lst = firstByLocal(presDoc.documentElement, 'sldIdLst');
    if (!lst) {
        return numericOrder;
    }
    const ordered = [];
    const known = new Set(allSlides);
    for (const sldId of childrenByLocal(lst, 'sldId')) {
        const relId = relRef(sldId, 'id');
        const target = relId && rels[relId];
        if (!target) {
            continue;
        }
        // presentation rels targets are relative to ppt/ (e.g. slides/slide1.xml)
        const path = `ppt/${target.replace(/^\/+/u, '').replace(/^ppt\//u, '')}`;
        if (known.has(path) && !ordered.includes(path)) {
            ordered.push(path);
        }
    }
    return ordered.length ? ordered : numericOrder;
};

/**
 * Extracts a PPTX file into assistant attachments. Every slide's text (title
 * first, then body shapes and tables) is extracted and split into byte-budgeted
 * sections keyed by slide number; every embedded figure is delivered as an
 * image, up to the image cap, at native quality (downscaled only when an edge
 * exceeds the vision-model sweet spot). Notes slides are not included.
 * @param {File} file
 * @param {{ maxImages?: Number, chunkBudget?: Number }} [options]
 * @returns {Promise<{ attachments: Object[], sections: Number, pageCount: Number,
 *   truncated: Boolean, textPages: Number, imagePages: Number, skippedImages: Number }>}
 */
export const extractPptxAttachments = async (file, options = {}) => {
    const { maxImages = DEFAULT_MAX_IMAGES, chunkBudget = CHUNK_BUDGET_BYTES } = options;
    const name = file.name || 'presentation.pptx';
    const arrayBuffer = await file.arrayBuffer();
    const JSZip = await loadJsZip();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const slidePaths = await resolveSlideOrder(zip);

    // --- TEXT + referenced media (single ordered pass over slides) ---
    const builder = createSectionBuilder({ chunkBudget });
    const orderedMedia = [];
    const seenMedia = new Set();
    // remember which slide first referenced each media path for figure naming
    const mediaSlide = new Map();
    const pushMedia = (path, slideNum) => {
        if (!seenMedia.has(path)) {
            seenMedia.add(path);
            orderedMedia.push(path);
            mediaSlide.set(path, slideNum);
        }
    };

    for (let i = 0; i < slidePaths.length; i += 1) {
        const slideNum = i + 1;
        const slideRoot = new DOMParser()
            .parseFromString(await zip.file(slidePaths[i]).async('string'), 'application/xml')
            .documentElement;

        const text = slideText(slideRoot);
        builder.add(slideNum, `[Slide ${slideNum}]${text ? `\n${text}` : ''}`);

        // resolve this slide's media via its own rels part
        const relsPath = slidePaths[i].replace(/^(.*\/)([^/]+)$/u, '$1_rels/$2.rels');
        const relsFile = zip.file(relsPath);
        const rels = parseRels(relsFile ? await relsFile.async('string') : '');
        slideBlipMediaPaths(slideRoot, rels).forEach((path) => pushMedia(path, slideNum));
    }
    const { sections, total, truncated, lastUnit: textPages } = builder.finish();

    // unreferenced media (theme/master art) appended after slide-referenced ones
    Object.keys(zip.files)
        .filter((path) => (/^ppt\/media\//u).test(path) && !zip.files[path].dir)
        .sort()
        .forEach((path) => {
            if (!seenMedia.has(path)) {
                seenMedia.add(path);
                orderedMedia.push(path);
                // no slide number -> numbered as a bare figure below
            }
        });

    // --- IMAGES ---
    const images = [];
    let skippedImages = 0;
    let extraFigure = 0;
    for (const path of orderedMedia) {
        if (images.length >= maxImages) {
            break;
        }
        const converted = await convertZipMedia(zip, path);
        if (!converted) {
            skippedImages += 1;
            continue;
        }
        const slideNum = mediaSlide.get(path);
        let figureName;
        if (slideNum) {
            figureName = `${name} (slide ${slideNum}, figure ${images.length + 1})`;
        } else {
            extraFigure += 1;
            figureName = `${name} (figure ${extraFigure})`;
        }
        images.push({
            kind: 'image',
            mediaType: converted.mediaType,
            name: figureName,
            data: converted.data
        });
    }

    const imagePages = images.length;

    if (truncated && total) {
        sections[total - 1].text += `\n\n[Presentation truncated: text included for the first ${textPages}`
            + ` of ${slidePaths.length} slides, figure images for the first ${imagePages}.`
            + ' Tell the user if you need the rest.]';
    }

    const textAttachment = toTextAttachment(sections, name);

    return {
        // every part carries group: <file name> so the composer renders the
        // whole PPTX as ONE chip instead of a chip per figure
        attachments: [
            textAttachment,
            ...images.map((image) => ({ ...image, group: name }))
        ],
        sections: total,
        pageCount: slidePaths.length,
        truncated,
        textPages,
        imagePages,
        skippedImages
    };
};

export default { extractPptxAttachments };
