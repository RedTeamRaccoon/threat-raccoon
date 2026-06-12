/**
 * @name ooxmlMedia
 * @description Format-agnostic media machinery shared by the OOXML attachment
 * extractors (docx, pptx). OOXML containers (DOCX, PPTX) are ZIPs whose embedded
 * figures live verbatim under their media folder. This module owns the per-media-file
 * conversion pipeline (raster pass-through + >1568px downscale, svg rasterize,
 * emf/wmf via emf-converter with a blank-output sanity check, tiff/unknown skip,
 * <100px-both-dims size floor) and the lazy jszip loader, so the per-format
 * modules only carry their own XML parsing. jszip and emf-converter are loaded
 * lazily so they stay out of the main bundle until an OOXML file is attached.
 */

// keep the longest image edge under the common vision-model sweet spot
export const MAX_RENDER_DIM = 1568;
const JPEG_QUALITY = 0.85;
// icons/bullets: skip when both known dimensions are below this
const MIN_IMAGE_DIM = 100;
// a blank/failed EMF/WMF conversion tends to produce a tiny data URL
const MIN_VECTOR_DATA_URL_LENGTH = 2000;

let jszipPromise = null;
export const loadJsZip = () => {
    if (!jszipPromise) {
        jszipPromise = import(/* webpackChunkName: "ooxml" */ 'jszip').then((m) => m.default || m);
    }
    return jszipPromise;
};

let emfPromise = null;
const loadEmfConverter = () => {
    if (!emfPromise) {
        emfPromise = import(/* webpackChunkName: "ooxml" */ 'emf-converter');
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

export const extOf = (path) => {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
};

// load an image data URL into a canvas-measurable Image; resolves with the
// Image (with naturalWidth/Height) or rejects on error
const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
});

export const dataUrlFromBase64 = (base64, mediaType) => `data:${mediaType};base64,${base64}`;

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
 * rendered (counts toward skippedImages). `arrayBuffer` is the raw media bytes
 * (only needed for emf/wmf); `base64` is the same bytes base64-encoded (jszip
 * provides both cheaply).
 * @param {String} ext lower-case media extension (no dot)
 * @param {String} base64 the media bytes, base64-encoded
 * @param {ArrayBuffer} [arrayBuffer] the raw media bytes (emf/wmf only)
 * @returns {Promise<{ data: String, mediaType: String }|null>}
 */
export const convertMedia = async (ext, base64, arrayBuffer) => {
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
 * Reads one zip media entry and converts it via the shared pipeline, fetching
 * the raw ArrayBuffer only for the vector formats that need it.
 * @param {Object} zip a loaded JSZip instance
 * @param {String} path the in-zip media path
 * @returns {Promise<{ data: String, mediaType: String }|null>}
 */
export const convertZipMedia = async (zip, path) => {
    const entry = zip.file(path);
    if (!entry) {
        return null;
    }
    const ext = extOf(path);
    const base64 = await entry.async('base64');
    let buffer = null;
    if (ext === 'emf' || ext === 'wmf') {
        const arr = await entry.async('uint8array');
        buffer = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
    }
    return convertMedia(ext, base64, buffer);
};

export default { loadJsZip, convertMedia, convertZipMedia, extOf, dataUrlFromBase64, MAX_RENDER_DIM };
