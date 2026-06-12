/**
 * @name pdfAttachments
 * @description Converts an attached PDF into assistant attachments: one text
 * attachment with the extracted text (CJK-capable via pdf.js cMaps) plus images
 * so vision models can read diagrams the text layer cannot express. Rather than
 * rendering EVERY page at page resolution (where an embedded architecture figure
 * lands as mush and text-only pages waste the image budget), this module:
 *   1. EXTRACTS embedded figures from each page's operator list at their own
 *      native resolution (deduped, size-floored, strip-stitched), and
 *   2. RENDERS the full page only when the page looks graphical (mixed
 *      path/image content the text layer can't carry).
 * Long documents are CHUNKED rather than truncated: the text is split into
 * sections of at most CHUNK_BUDGET_BYTES; section 1 rides in the attachment's
 * `data` and sections 2..N ride along in `pendingSections` so the send pipeline
 * can feed them to the agent one at a time. pdf.js is loaded lazily so it stays
 * out of the main bundle until a PDF is actually attached.
 */

import { createSectionBuilder, toTextAttachment, CHUNK_BUDGET_BYTES } from './sectionedText.js';

// keep the longest edge under the common vision-model sweet spot
const MAX_RENDER_DIM = 1568;
const JPEG_QUALITY = 0.85;
// page images are the token-expensive part; text is cheap, so it keeps flowing
// long after images stop. This caps TOTAL image attachments (page renders +
// extracted figures), not page renders alone.
const DEFAULT_MAX_IMAGES = 20;

// figures smaller than this are bullets/icons/logos, not diagrams
const MIN_FIGURE_EDGE = 100;
const MIN_FIGURE_AREA = 40000;
// at most this many extracted figures per page (a busy slide collage shouldn't
// flood the budget with near-duplicates)
const MAX_FIGURES_PER_PAGE = 6;

// strip-stitching: Word/PowerPoint -> PDF exports slice one picture into
// horizontal strips painted as consecutive image ops of equal width and small
// height. Group >= STRIP_MIN_GROUP such consecutive ops and stitch them back.
const STRIP_MAX_HEIGHT = 120;
const STRIP_MIN_GROUP = 3;

// a page is "graphical" (worth a full render) when image+path ops are a real
// share of its content, or it has any image at all
const GRAPHICAL_RATIO = 0.15;
// above this many image ops a page is image-dense: its extracted figures carry
// more signal than a full-page collage render, so skip the page render
const IMAGE_DENSE_OPS = 8;

// BASE_URL is the Vue CLI publicPath ('/' in dev, '/public/' in production);
// vue.config.js copies the pdf.js cMaps/standard fonts to pdfjs/ in the build.
const assetBase = () => `${process.env.BASE_URL || '/'}pdfjs/`;

let pdfjsPromise = null;
const loadPdfJs = () => {
    if (!pdfjsPromise) {
        pdfjsPromise = Promise.all([
            import(/* webpackChunkName: "pdfjs" */ 'pdfjs-dist/legacy/build/pdf'),
            import(/* webpackChunkName: "pdfjs" */ 'pdfjs-dist/legacy/build/pdf.worker.entry')
        ]).then(([pdfjs, worker]) => {
            pdfjs.GlobalWorkerOptions.workerSrc = worker.default || worker;
            return pdfjs;
        });
    }
    return pdfjsPromise;
};

const pageText = async (page) => {
    const textContent = await page.getTextContent();
    let text = '';
    for (const item of textContent.items) {
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
    }
    return text.trim();
};

const pageImage = async (page) => {
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_RENDER_DIM / Math.max(unscaled.width, unscaled.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
};

// ----- embedded figure extraction ---------------------------------------

// image-paint ops whose first arg is the XObject/image object name. (This
// legacy build folds JPEG painting into paintImageXObject; paintJpegXObject is
// referenced defensively in case a build still emits it.)
const imageOpNames = (pdfjs) => {
    const names = ['paintImageXObject', 'paintJpegXObject', 'paintImageMaskXObject'];
    return new Set(names.map((n) => pdfjs.OPS[n]).filter((op) => op !== undefined));
};

const pathOpSet = (pdfjs) => new Set([
    pdfjs.OPS.fill,
    pdfjs.OPS.stroke,
    pdfjs.OPS.fillStroke,
    pdfjs.OPS.eoFill,
    pdfjs.OPS.closePathStroke,
    pdfjs.OPS.closePathFillStroke,
    pdfjs.OPS.constructPath
].filter((op) => op !== undefined));

const textOpSet = (pdfjs) => new Set([
    pdfjs.OPS.showText,
    pdfjs.OPS.showSpacedText,
    pdfjs.OPS.nextLineShowText,
    pdfjs.OPS.nextLineSetSpacingShowText
].filter((op) => op !== undefined));

// Resolve an image XObject by name. pdf.js can throw "Requesting object that
// isn't resolved" — caller swallows that so one bad image never aborts the doc.
const resolveImageObject = (page, name) => new Promise((resolve, reject) => {
    try {
        page.objs.get(name, (obj) => resolve(obj));
    } catch (err) {
        reject(err);
    }
});

// Paint a resolved pdf.js image object onto a 2d context at (x, y). Prefers the
// ImageBitmap (newer builds) and falls back to raw { data, kind } buffers.
// Returns { ok, hasAlpha }.
const paintObjectToContext = (ctx, obj, x, y) => {
    const width = obj.width;
    const height = obj.height;
    if (obj.bitmap) {
        ctx.drawImage(obj.bitmap, x, y);
        return { ok: true, hasAlpha: false };
    }
    if (!obj.data) {
        return { ok: false, hasAlpha: false };
    }
    // expand to RGBA for putImageData; track whether real alpha was present
    const rgba = new Uint8ClampedArray(width * height * 4);
    let hasAlpha = false;
    const data = obj.data;
    // kind: 1 = GRAYSCALE_1BPP (one byte per pixel here, 0/255), 2 = RGB_24BPP,
    // 3 = RGBA_32BPP
    if (obj.kind === 3) {
        for (let i = 0; i < width * height; i += 1) {
            rgba[i * 4] = data[i * 4];
            rgba[i * 4 + 1] = data[i * 4 + 1];
            rgba[i * 4 + 2] = data[i * 4 + 2];
            const a = data[i * 4 + 3];
            rgba[i * 4 + 3] = a;
            if (a !== 255) {
                hasAlpha = true;
            }
        }
    } else if (obj.kind === 2) {
        for (let i = 0; i < width * height; i += 1) {
            rgba[i * 4] = data[i * 3];
            rgba[i * 4 + 1] = data[i * 3 + 1];
            rgba[i * 4 + 2] = data[i * 3 + 2];
            rgba[i * 4 + 3] = 255;
        }
    } else {
        // grayscale (kind 1) or unknown single-channel: replicate the byte
        for (let i = 0; i < width * height; i += 1) {
            const g = data[i];
            rgba[i * 4] = g;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = g;
            rgba[i * 4 + 3] = 255;
        }
    }
    const imageData = (typeof ImageData !== 'undefined')
        ? new ImageData(rgba, width, height)
        : { data: rgba, width, height };
    ctx.putImageData(imageData, x, y);
    return { ok: true, hasAlpha };
};

// Encode one (or one stitched) image object group to a downscaled dataURL.
// `entries` is an array of resolved image objects to stack vertically (a single
// figure is a group of one). Returns the dataURL string, or null if it fails or
// falls below the size floor.
const encodeFigure = (entries) => {
    const width = entries[0].width;
    let totalHeight = 0;
    for (const obj of entries) {
        totalHeight += obj.height;
    }
    if (!width || !totalHeight) {
        return null;
    }

    // paint at native resolution first, then downscale once
    const native = document.createElement('canvas');
    native.width = width;
    native.height = totalHeight;
    const nativeCtx = native.getContext('2d');
    if (!nativeCtx) {
        return null;
    }
    let hasAlpha = false;
    let y = 0;
    for (const obj of entries) {
        const res = paintObjectToContext(nativeCtx, obj, 0, y);
        if (!res.ok) {
            return null;
        }
        hasAlpha = hasAlpha || res.hasAlpha;
        y += obj.height;
    }

    // size floor (applied AFTER stitching, on the assembled image)
    if (Math.min(width, totalHeight) < MIN_FIGURE_EDGE || width * totalHeight < MIN_FIGURE_AREA) {
        return null;
    }

    const scale = Math.min(1, MAX_RENDER_DIM / Math.max(width, totalHeight));
    let target = native;
    if (scale < 1) {
        const scaled = document.createElement('canvas');
        scaled.width = Math.max(1, Math.round(width * scale));
        scaled.height = Math.max(1, Math.round(totalHeight * scale));
        const scaledCtx = scaled.getContext('2d');
        if (!scaledCtx) {
            return null;
        }
        scaledCtx.drawImage(native, 0, 0, scaled.width, scaled.height);
        target = scaled;
    }

    return hasAlpha
        ? { dataUrl: target.toDataURL('image/png'), mediaType: 'image/png' }
        : { dataUrl: target.toDataURL('image/jpeg', JPEG_QUALITY), mediaType: 'image/jpeg' };
};

/**
 * Walks a page's operator list, extracts embedded figures, and counts op
 * classes for the selective-render decision. Resilient: any failure to resolve
 * an image is skipped; a failure of the whole walk is caught by the caller.
 * @returns {{ figures: Object[], imageOps: Number, pathOps: Number, textOps: Number }}
 *   figures are { dataUrl, mediaType, figureIndex }
 */
const extractPageGraphics = async (page, pdfjs, seenDataUrls) => {
    const ops = await page.getOperatorList();
    const imgOps = imageOpNames(pdfjs);
    const pathOps = pathOpSet(pdfjs);
    const textOps = textOpSet(pdfjs);

    let imageOps = 0;
    let pathOpCount = 0;
    let textOpCount = 0;

    // collect paint ops in order so strip-stitching can see consecutiveness
    const paints = [];
    for (let i = 0; i < ops.fnArray.length; i += 1) {
        const fn = ops.fnArray[i];
        if (imgOps.has(fn)) {
            imageOps += 1;
            const arg = ops.argsArray[i];
            const objName = arg && arg[0];
            if (typeof objName === 'string') {
                paints.push(objName);
            }
        } else if (pathOps.has(fn)) {
            pathOpCount += 1;
        } else if (textOps.has(fn)) {
            textOpCount += 1;
        }
    }

    const figures = [];
    // dedupe by object name within the page (repeated XObject paints)
    const resolvedByName = new Map();
    const orderedNames = [];
    for (const objName of paints) {
        if (!resolvedByName.has(objName)) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const obj = await resolveImageObject(page, objName);
                resolvedByName.set(objName, obj || null);
            } catch (err) {
                resolvedByName.set(objName, null);
            }
        }
        orderedNames.push(objName);
    }

    // build the paint sequence (in op order) of resolved objects, preserving
    // consecutiveness for strip detection
    const sequence = orderedNames
        .map((nm) => ({ name: nm, obj: resolvedByName.get(nm) }))
        .filter((e) => e.obj && e.obj.width && e.obj.height);

    const emit = (entries) => {
        if (figures.length >= MAX_FIGURES_PER_PAGE) {
            return;
        }
        let encoded;
        try {
            encoded = encodeFigure(entries.map((e) => e.obj));
        } catch (err) {
            encoded = null;
        }
        if (!encoded) {
            return;
        }
        // dedupe ACROSS pages by output bytes (per-page names can't be compared)
        if (seenDataUrls.has(encoded.dataUrl)) {
            return;
        }
        seenDataUrls.add(encoded.dataUrl);
        figures.push({ ...encoded, figureIndex: figures.length + 1 });
    };

    // walk the sequence, greedily grouping consecutive equal-width short strips
    let i = 0;
    while (i < sequence.length) {
        const start = sequence[i];
        let j = i + 1;
        // a strip group: consecutive, equal width, each height <= STRIP_MAX_HEIGHT
        if (start.obj.height <= STRIP_MAX_HEIGHT) {
            while (j < sequence.length
                && sequence[j].obj.width === start.obj.width
                && sequence[j].obj.height <= STRIP_MAX_HEIGHT) {
                j += 1;
            }
        }
        const groupSize = j - i;
        if (groupSize >= STRIP_MIN_GROUP) {
            emit(sequence.slice(i, j));
            i = j;
        } else {
            // conservative: when unsure, emit individually
            emit([start]);
            i += 1;
        }
    }

    return { figures, imageOps, pathOps: pathOpCount, textOps: textOpCount };
};

/**
 * Decides whether a page warrants a full-page render. Render when the page looks
 * graphical (mixed path/image content) AND it isn't image-dense with figures
 * already extracted (figures carry more signal than the collage).
 */
const shouldRenderPage = ({ imageOps, pathOps, textOps }, extractedFigureCount) => {
    const total = Math.max(1, imageOps + pathOps + textOps);
    const graphical = (imageOps + pathOps) / total > GRAPHICAL_RATIO || imageOps >= 1;
    if (!graphical) {
        return false;
    }
    if (imageOps > IMAGE_DENSE_OPS && extractedFigureCount > 0) {
        return false;
    }
    return true;
};

/**
 * Extracts a PDF file into assistant attachments. The text of EVERY page is
 * extracted and split into sections of at most `chunkBudget` bytes (capped at
 * MAX_SECTIONS — pages beyond the cap are genuinely truncated). Diagrams reach
 * the vision model two ways: embedded figures pulled at native resolution, and
 * full-page renders for pages that look graphical.
 *
 * IMAGE BUDGET / PRIORITY POLICY: `maxPages` caps the TOTAL number of image
 * attachments (page renders + figures combined). Images are produced in page
 * order and, within a page, figures precede that page's render. When the total
 * exceeds the budget we drop from the END (later pages first) — a simple,
 * deterministic policy that favours earlier pages, which is where overview
 * diagrams usually live.
 *
 * @param {File} file
 * @param {{ maxPages?: Number, chunkBudget?: Number }} [options]
 * @returns {Promise<{ attachments: Object[], sections: Number, pageCount: Number,
 *                     truncated: Boolean, textPages: Number, imagePages: Number,
 *                     figures: Number }>}
 */
export const extractPdfAttachments = async (file, options = {}) => {
    const { maxPages = DEFAULT_MAX_IMAGES, chunkBudget = CHUNK_BUDGET_BYTES } = options;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({
        data,
        // cMaps are required to extract CJK (e.g. Chinese) text correctly
        cMapUrl: `${assetBase()}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetBase()}standard_fonts/`
    }).promise;

    const name = file.name || 'document.pdf';
    const builder = createSectionBuilder({ chunkBudget });

    // dedupe figure output bytes across all pages (repeated logos/headers)
    const seenDataUrls = new Set();
    // images in page order; figures precede their page's render. We collect
    // everything then apply the budget by dropping from the end.
    const images = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
        const page = await doc.getPage(p); // eslint-disable-line no-await-in-loop

        if (!builder.isTruncated()) {
            // section cap reached inside add(): this page and the rest are dropped
            builder.add(p, `[Page ${p}]\n${await pageText(page)}`); // eslint-disable-line no-await-in-loop
        }

        // per-page graphic work is fully isolated: a thrown operator list or
        // figure extraction must never cost the page its text or its render
        let graphics = { figures: [], imageOps: 0, pathOps: 0, textOps: 0 };
        try {
            // eslint-disable-next-line no-await-in-loop
            graphics = await extractPageGraphics(page, pdfjs, seenDataUrls);
        } catch (err) {
            graphics = { figures: [], imageOps: 0, pathOps: 0, textOps: 0 };
        }

        for (const fig of graphics.figures) {
            images.push({
                kind: 'image',
                mediaType: fig.mediaType,
                name: `${name} (page ${p}, figure ${fig.figureIndex})`,
                data: fig.dataUrl,
                page: p,
                isRender: false
            });
        }

        let render = true;
        try {
            render = shouldRenderPage(graphics, graphics.figures.length);
        } catch (err) {
            render = false;
        }
        if (render) {
            let rendered = null;
            try {
                // eslint-disable-next-line no-await-in-loop
                rendered = await pageImage(page);
            } catch (err) {
                rendered = null;
            }
            if (rendered) {
                images.push({
                    kind: 'image',
                    mediaType: 'image/jpeg',
                    name: `${name} (page ${p})`,
                    data: rendered,
                    page: p,
                    isRender: true
                });
            }
        }
    }

    // apply the TOTAL image budget: keep the first `maxPages` in page order,
    // drop the rest (later pages first)
    const kept = images.slice(0, maxPages);
    const renderedPages = new Set(
        kept.filter((img) => img.isRender).map((img) => img.page)
    );
    const figureCount = kept.filter((img) => !img.isRender).length;
    // imagePages keeps its name but now means "pages actually rendered"
    const imagePages = renderedPages.size;

    const { sections, total, truncated, lastUnit: textPages } = builder.finish();
    if (truncated && total) {
        sections[total - 1].text += `\n\n[Document truncated: text included for the first ${textPages}`
            + ` of ${doc.numPages} pages, page images for ${imagePages} graphical page(s)`
            + ` and ${figureCount} extracted figure(s).`
            + ' Tell the user if you need the rest.]';
    }

    const textAttachment = toTextAttachment(sections, name);

    return {
        // every part carries group: <file name> so the composer can render the
        // whole PDF as ONE chip instead of a chip per page
        attachments: [
            textAttachment,
            ...kept.map((image) => ({
                kind: image.kind,
                mediaType: image.mediaType,
                name: image.name,
                data: image.data,
                group: name
            }))
        ],
        sections: total,
        pageCount: doc.numPages,
        truncated,
        textPages,
        imagePages,
        figures: figureCount
    };
};

export default { extractPdfAttachments };
