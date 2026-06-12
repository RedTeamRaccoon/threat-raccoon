import JSZip from 'jszip';

import { extractDocxAttachments } from '@/service/assistant/docxAttachments.js';

const mockConvertEmf = jest.fn();
const mockConvertWmf = jest.fn();

jest.mock('emf-converter', () => ({
    convertEmfToDataUrl: (...args) => mockConvertEmf(...args),
    convertWmfToDataUrl: (...args) => mockConvertWmf(...args)
}));

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// --- document.xml builders --------------------------------------------------

const para = (text, style) => {
    const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
    return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
};

const tableRow = (cells) => `<w:tr>${cells.map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
const table = (rows) => `<w:tbl>${rows.map(tableRow).join('')}</w:tbl>`;

const blip = (relId) => `<w:p><w:r><w:drawing><wp:inline xmlns:wp="x">`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData>`
    + `<pic:pic xmlns:pic="x"><pic:blipFill><a:blip r:embed="${relId}"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></pic:blipFill></pic:pic>`
    + `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const documentXml = (bodyInner) => `<?xml version="1.0"?>`
    + `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`;

const relsXml = (rels) => `<?xml version="1.0"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rels.map((r) => `<Relationship Id="${r.id}" Type="t" Target="${r.target}"/>`).join('')
    + `</Relationships>`;

// builds a fake File from a synthetic DOCX using the real jszip
const buildDocx = async ({ name = 'doc.docx', body = '', rels = [], media = {} }) => {
    const zip = new JSZip();
    zip.file('word/document.xml', documentXml(body));
    if (rels.length) {
        zip.file('word/_rels/document.xml.rels', relsXml(rels));
    }
    Object.entries(media).forEach(([path, bytes]) => zip.file(path, bytes));
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    return { name, arrayBuffer: () => Promise.resolve(buf) };
};

// --- Image / canvas mocks ---------------------------------------------------

let imageDims = { naturalWidth: 200, naturalHeight: 200 };
let imageShouldFail = false;

class MockImage {
    constructor() {
        this.naturalWidth = imageDims.naturalWidth;
        this.naturalHeight = imageDims.naturalHeight;
    }

    set src(value) {
        this._src = value;
        Promise.resolve().then(() => {
            if (imageShouldFail) {
                if (this.onerror) {
                    this.onerror();
                }
            } else if (this.onload) {
                this.onload();
            }
        });
    }
}

describe('service/assistant/docxAttachments.js', () => {
    const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: jest.fn(),
        toDataURL: jest.fn()
    };
    let realCreateElement;

    beforeEach(() => {
        jest.clearAllMocks();
        imageDims = { naturalWidth: 200, naturalHeight: 200 };
        imageShouldFail = false;
        fakeCanvas.getContext.mockReturnValue({ drawImage: jest.fn() });
        fakeCanvas.toDataURL.mockImplementation((type) => `data:${type || 'image/png'};base64,U0NBTEVE`);
        global.Image = MockImage;
        realCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation(
            (tag) => (tag === 'canvas' ? fakeCanvas : realCreateElement(tag))
        );
    });

    afterEach(() => {
        document.createElement.mockRestore();
    });

    it('extracts paragraphs, headings, and tables in order with markdown #s', async () => {
        const body = para('My Title', 'Title')
            + para('Intro paragraph.')
            + para('Section A', 'Heading1')
            + para('Body text.')
            + para('Sub', 'Heading2')
            + para('')
            + table([['a', 'b'], ['c', 'd']]);
        const file = await buildDocx({ body });

        const { attachments, pageCount, truncated } = await extractDocxAttachments(file);
        const text = attachments[0].data;

        expect(truncated).toBe(false);
        expect(pageCount).toBe(1);
        expect(text).toContain('# My Title');
        expect(text).toContain('Intro paragraph.');
        expect(text).toContain('# Section A');
        expect(text).toContain('## Sub');
        expect(text).toContain('a | b');
        expect(text).toContain('c | d');
        // empty paragraph skipped
        expect(text.indexOf('# My Title')).toBeLessThan(text.indexOf('# Section A'));
        expect(text.indexOf('# Section A')).toBeLessThan(text.indexOf('a | b'));
    });

    it('preserves inner spaces from xml:space="preserve" runs', async () => {
        const file = await buildDocx({ body: para('hello   world') });
        const { attachments } = await extractDocxAttachments(file);
        expect(attachments[0].data).toContain('hello   world');
    });

    it('extracts blip-referenced images in order via rels resolution', async () => {
        const file = await buildDocx({
            body: blip('rId1') + para('between') + blip('rId2'),
            rels: [
                { id: 'rId1', target: 'media/image1.png' },
                { id: 'rId2', target: 'media/image2.png' }
            ],
            media: {
                'word/media/image1.png': 'AAA',
                'word/media/image2.png': 'BBB'
            }
        });

        const { attachments } = await extractDocxAttachments(file);
        const images = attachments.filter((a) => a.kind === 'image');
        expect(images).toHaveLength(2);
        expect(images[0].name).toBe('doc.docx (figure 1)');
        expect(images[1].name).toBe('doc.docx (figure 2)');
        // all parts share the file-name group -> one chip
        expect(new Set(attachments.map((a) => a.group))).toEqual(new Set(['doc.docx']));
    });

    it('appends unreferenced media (e.g. header images) after blips', async () => {
        const file = await buildDocx({
            body: blip('rId1'),
            rels: [{ id: 'rId1', target: 'media/image1.png' }],
            media: {
                'word/media/image1.png': 'AAA',
                'word/media/image9.png': 'ZZZ'
            }
        });

        const { attachments } = await extractDocxAttachments(file);
        const images = attachments.filter((a) => a.kind === 'image');
        // referenced image1 + unreferenced image9, deduped (no double image1)
        expect(images).toHaveLength(2);
    });

    it('passes a small png through and downscales an oversized one', async () => {
        imageDims = { naturalWidth: 300, naturalHeight: 300 };
        const small = await buildDocx({
            media: { 'word/media/image1.png': 'AAA' }
        });
        const passthrough = await extractDocxAttachments(small);
        const pImg = passthrough.attachments.find((a) => a.kind === 'image');
        expect(pImg.mediaType).toBe('image/png');
        // pass-through carries the raw media bytes as a data URL (not canvas re-encoded)
        expect(pImg.data).toMatch(/^data:image\/png;base64,/u);
        expect(pImg.data).not.toBe('data:image/png;base64,U0NBTEVE');

        imageDims = { naturalWidth: 4000, naturalHeight: 3000 };
        const big = await buildDocx({
            media: { 'word/media/image1.png': 'AAA' }
        });
        const scaled = await extractDocxAttachments(big);
        const sImg = scaled.attachments.find((a) => a.kind === 'image');
        // downscaled via canvas -> PNG to keep diagrams crisp
        expect(sImg.mediaType).toBe('image/png');
        expect(sImg.data).toBe('data:image/png;base64,U0NBTEVE');
    });

    it('skips tiny icon-sized images', async () => {
        imageDims = { naturalWidth: 40, naturalHeight: 40 };
        const file = await buildDocx({ media: { 'word/media/image1.png': 'AAA' } });
        const { attachments, skippedImages } = await extractDocxAttachments(file);
        expect(attachments.filter((a) => a.kind === 'image')).toHaveLength(0);
        expect(skippedImages).toBe(1);
    });

    it('converts EMF media and counts a failed conversion as skipped', async () => {
        mockConvertEmf.mockResolvedValueOnce(`data:image/png;base64,${'Q'.repeat(3000)}`);
        const ok = await buildDocx({ media: { 'word/media/image1.emf': 'EMFBYTES' } });
        const okResult = await extractDocxAttachments(ok);
        expect(okResult.attachments.filter((a) => a.kind === 'image')).toHaveLength(1);
        expect(okResult.skippedImages).toBe(0);
        expect(mockConvertEmf).toHaveBeenCalled();

        // tiny/blank result -> treated as failed
        mockConvertEmf.mockResolvedValueOnce('data:image/png;base64,Zm9v');
        const blank = await buildDocx({ media: { 'word/media/image1.emf': 'EMFBYTES' } });
        const blankResult = await extractDocxAttachments(blank);
        expect(blankResult.attachments.filter((a) => a.kind === 'image')).toHaveLength(0);
        expect(blankResult.skippedImages).toBe(1);

        // throwing converter -> skipped, no throw
        mockConvertEmf.mockRejectedValueOnce(new Error('boom'));
        const thrown = await buildDocx({ media: { 'word/media/image1.emf': 'EMFBYTES' } });
        const thrownResult = await extractDocxAttachments(thrown);
        expect(thrownResult.skippedImages).toBe(1);
    });

    it('skips tiff and unknown media types', async () => {
        const file = await buildDocx({
            media: {
                'word/media/image1.tiff': 'TIFF',
                'word/media/image2.xyz': 'WHAT'
            }
        });
        const { attachments, skippedImages } = await extractDocxAttachments(file);
        expect(attachments.filter((a) => a.kind === 'image')).toHaveLength(0);
        expect(skippedImages).toBe(2);
    });

    it('caps images at maxImages', async () => {
        const media = {};
        for (let i = 1; i <= 5; i += 1) {
            media[`word/media/image${i}.png`] = 'AAA';
        }
        const file = await buildDocx({ media });
        const { attachments } = await extractDocxAttachments(file, { maxImages: 3 });
        expect(attachments.filter((a) => a.kind === 'image')).toHaveLength(3);
    });

    it('chunks many paragraph blocks into pending sections', async () => {
        // 60 paragraphs -> 3 blocks of 25/25/10
        const body = Array.from({ length: 60 }, (unused, i) => para(`paragraph number ${i}`)).join('');
        const file = await buildDocx({ body });

        const { attachments, sections, truncated } = await extractDocxAttachments(file, { chunkBudget: 120 });
        expect(sections).toBeGreaterThan(1);
        expect(truncated).toBe(false);
        const text = attachments[0];
        expect(text.data).toContain('[Block 1]');
        expect(text.data).toContain('[Document continues: section 1');
        expect(text.pendingSections.length).toBe(sections - 1);
    });

    it('marks the document truncated and notes paragraph blocks', async () => {
        const body = Array.from({ length: 300 }, (unused, i) => para(`paragraph number ${i}`)).join('');
        const file = await buildDocx({ body });

        const { sections, truncated, attachments, textPages, pageCount } =
            await extractDocxAttachments(file, { chunkBudget: 1 });
        expect(truncated).toBe(true);
        expect(sections).toBe(8);
        const last = attachments[0].pendingSections[attachments[0].pendingSections.length - 1];
        expect(last.text).toContain('paragraph blocks');
        expect(last.text).toContain(`of ${pageCount} paragraph blocks`);
        expect(textPages).toBe(8);
    });

    it('exposes one group per file', async () => {
        const file = await buildDocx({
            body: blip('rId1'),
            rels: [{ id: 'rId1', target: 'media/image1.png' }],
            media: { 'word/media/image1.png': 'AAA' }
        });
        const { attachments } = await extractDocxAttachments(file);
        expect(new Set(attachments.map((a) => a.group))).toEqual(new Set(['doc.docx']));
    });
});
