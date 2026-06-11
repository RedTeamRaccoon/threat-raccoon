/**
 * @name pdfAttachments
 * @description Converts an attached PDF into assistant attachments: one text
 * attachment with the extracted text (CJK-capable via pdf.js cMaps) plus one
 * rendered image per page so vision models can read diagrams the text layer
 * cannot express. Long documents are CHUNKED rather than truncated: the text
 * is split into sections of at most CHUNK_BUDGET_BYTES; section 1 rides in the
 * attachment's `data` and sections 2..N ride along in `pendingSections` so the
 * send pipeline can feed them to the agent one at a time. pdf.js is loaded
 * lazily so it stays out of the main bundle until a PDF is actually attached.
 */

// keep the longest page edge under the common vision-model sweet spot
const MAX_RENDER_DIM = 1568;
const JPEG_QUALITY = 0.85;
// page images are the token-expensive part; text is cheap, so it keeps flowing
// long after images stop
const DEFAULT_MAX_IMAGE_PAGES = 20;
// one section must fit comfortably in a single request even for CJK documents
// on 128K-token models, so the per-section budget stays well under the old
// single-attachment truncation budget
const CHUNK_BUDGET_BYTES = 150 * 1024;
// beyond this many sections the document is genuinely truncated
const MAX_SECTIONS = 8;

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

/**
 * Extracts a PDF file into assistant attachments. The text of EVERY page is
 * extracted and split into sections of at most `chunkBudget` bytes (capped at
 * MAX_SECTIONS — pages beyond the cap are genuinely truncated); each page is
 * also rendered as an image, but only up to the image-page cap.
 * @param {File} file
 * @param {{ maxPages?: Number, chunkBudget?: Number }} [options]
 * @returns {Promise<{ attachments: Object[], sections: Number, pageCount: Number,
 *                     truncated: Boolean, textPages: Number, imagePages: Number }>}
 */
export const extractPdfAttachments = async (file, options = {}) => {
    const { maxPages = DEFAULT_MAX_IMAGE_PAGES, chunkBudget = CHUNK_BUDGET_BYTES } = options;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({
        data,
        // cMaps are required to extract CJK (e.g. Chinese) text correctly
        cMapUrl: `${assetBase()}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetBase()}standard_fonts/`
    }).promise;

    const imagePages = Math.min(doc.numPages, maxPages);
    const name = file.name || 'document.pdf';

    const rawSections = [];
    const images = [];
    let current = null;
    let textTruncated = false;
    for (let p = 1; p <= doc.numPages; p += 1) {
        const wantText = !textTruncated;
        const wantImage = p <= imagePages;
        if (!wantText && !wantImage) {
            break;
        }
        const page = await doc.getPage(p);
        if (wantText) {
            const entry = `[Page ${p}]\n${await pageText(page)}`;
            if (current && current.bytes + entry.length > chunkBudget) {
                rawSections.push(current);
                current = null;
                if (rawSections.length >= MAX_SECTIONS) {
                    // section cap reached: this page and the rest are dropped
                    textTruncated = true;
                }
            }
            if (!textTruncated) {
                if (!current) {
                    current = { startPage: p, endPage: p, parts: [], bytes: 0 };
                }
                current.parts.push(entry);
                current.bytes += entry.length;
                current.endPage = p;
            }
        }
        if (wantImage) {
            images.push({
                kind: 'image',
                mediaType: 'image/jpeg',
                name: `${name} (page ${p})`,
                data: await pageImage(page)
            });
        }
    }
    if (current) {
        rawSections.push(current);
    }

    const total = rawSections.length;
    const textPages = total ? rawSections[total - 1].endPage : 0;
    const truncated = textTruncated;
    const sections = rawSections.map((section, idx) => ({
        index: idx + 1,
        total,
        pageRange: `${section.startPage}-${section.endPage}`,
        text: section.parts.join('\n\n')
    }));
    if (truncated && total) {
        sections[total - 1].text += `\n\n[Document truncated: text included for the first ${textPages}`
            + ` of ${doc.numPages} pages, page images for the first ${imagePages}.`
            + ' Tell the user if you need the rest.]';
    }

    let firstText = total ? sections[0].text : '';
    if (total > 1) {
        firstText += `\n\n[Document continues: section 1 of ${total}. Later sections will follow in this conversation.]`;
    }

    const textAttachment = { kind: 'text', mediaType: 'text/plain', name, group: name, data: firstText };
    if (total > 1) {
        // sections 2..N ride along; the send pipeline feeds them to the agent
        // one at a time AFTER section 1 has been incorporated into the model
        textAttachment.pendingSections = sections.slice(1);
    }

    return {
        // every part carries group: <file name> so the composer can render the
        // whole PDF as ONE chip instead of a chip per page
        attachments: [
            textAttachment,
            ...images.map((image) => ({ ...image, group: name }))
        ],
        sections: total,
        pageCount: doc.numPages,
        truncated,
        textPages,
        imagePages
    };
};

export default { extractPdfAttachments };
