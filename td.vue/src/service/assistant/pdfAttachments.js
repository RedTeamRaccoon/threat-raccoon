/**
 * @name pdfAttachments
 * @description Converts an attached PDF into assistant attachments: one text
 * attachment with the extracted text of every page (CJK-capable via pdf.js
 * cMaps) plus one rendered image per page so vision models can read diagrams
 * the text layer cannot express. pdf.js is loaded lazily so it stays out of
 * the main bundle until a PDF is actually attached.
 */

// keep the longest page edge under the common vision-model sweet spot
const MAX_RENDER_DIM = 1568;
const JPEG_QUALITY = 0.85;
const DEFAULT_MAX_PAGES = 20;

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
 * Extracts a PDF file into assistant attachments.
 * @param {File} file
 * @param {{ maxPages?: Number }} [options]
 * @returns {Promise<{ attachments: Object[], pageCount: Number, truncated: Boolean }>}
 */
export const extractPdfAttachments = async (file, { maxPages = DEFAULT_MAX_PAGES } = {}) => {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({
        data,
        // cMaps are required to extract CJK (e.g. Chinese) text correctly
        cMapUrl: `${assetBase()}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetBase()}standard_fonts/`
    }).promise;

    const pages = Math.min(doc.numPages, maxPages);
    const truncated = doc.numPages > pages;
    const name = file.name || 'document.pdf';

    const textParts = [];
    const images = [];
    for (let p = 1; p <= pages; p += 1) {
        const page = await doc.getPage(p);
        const text = await pageText(page);
        textParts.push(`[Page ${p}]\n${text}`);
        images.push({
            kind: 'image',
            mediaType: 'image/jpeg',
            name: `${name} (page ${p})`,
            data: await pageImage(page)
        });
    }

    let fullText = textParts.join('\n\n');
    if (truncated) {
        fullText += `\n\n[Only the first ${pages} of ${doc.numPages} pages were attached.]`;
    }

    return {
        attachments: [
            { kind: 'text', mediaType: 'text/plain', name, data: fullText },
            ...images
        ],
        pageCount: doc.numPages,
        truncated
    };
};

export default { extractPdfAttachments };
