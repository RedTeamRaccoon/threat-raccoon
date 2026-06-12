import JSZip from 'jszip';

import { extractPptxAttachments } from '@/service/assistant/pptxAttachments.js';

const mockConvertEmf = jest.fn();
const mockConvertWmf = jest.fn();

jest.mock('emf-converter', () => ({
    convertEmfToDataUrl: (...args) => mockConvertEmf(...args),
    convertWmfToDataUrl: (...args) => mockConvertWmf(...args)
}));

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// --- slide.xml builders -----------------------------------------------------

// a body text shape: paragraphs each a list of runs
const textShape = (paragraphs, phType) => {
    const ph = phType ? `<p:ph type="${phType}"/>` : '';
    const paras = paragraphs
        .map((runs) => `<a:p>${runs.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join('')}</a:p>`)
        .join('');
    return `<p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>`
        + `<p:txBody>${paras}</p:txBody></p:sp>`;
};

const title = (text) => textShape([[text]], 'title');
const body = (lines) => textShape(lines.map((l) => [l]));

const tableShape = (rows) => {
    const trs = rows.map((cells) => `<a:tr>${cells
        .map((c) => `<a:tc><a:txBody><a:p><a:r><a:t>${c}</a:t></a:r></a:p></a:txBody></a:tc>`)
        .join('')}</a:tr>`).join('');
    return `<p:graphicFrame><a:graphic><a:graphicData><a:tbl>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
};

const pic = (relId) => `<p:pic><p:blipFill><a:blip r:embed="${relId}"/></p:blipFill></p:pic>`;

const slideXml = (inner) => `<?xml version="1.0"?>`
    + `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}">`
    + `<p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;

const presentationXml = (rIds) => `<?xml version="1.0"?>`
    + `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst>`
    + rIds.map((id, i) => `<p:sldId id="${256 + i}" r:id="${id}"/>`).join('')
    + `</p:sldIdLst></p:presentation>`;

const relsXml = (rels) => `<?xml version="1.0"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rels.map((r) => `<Relationship Id="${r.id}" Type="t" Target="${r.target}"/>`).join('')
    + `</Relationships>`;

/**
 * Builds a fake File from a synthetic PPTX using the real jszip.
 * @param slides array of { inner, rels?: [{id,target}] } in display order
 * @param order optional explicit list of slide file numbers (defaults 1..N);
 *   presentation rels map rId{k} -> slides/slide{order[k]}.xml, and sldIdLst
 *   lists them in display order
 */
const buildPptx = async ({ name = 'deck.pptx', slides = [], order = null, media = {}, presentation = true }) => {
    const zip = new JSZip();
    const fileNumbers = order || slides.map((unused, i) => i + 1);
    const presRels = [];
    slides.forEach((slide, i) => {
        const fileNum = fileNumbers[i];
        zip.file(`ppt/slides/slide${fileNum}.xml`, slideXml(slide.inner));
        if (slide.rels && slide.rels.length) {
            zip.file(`ppt/slides/_rels/slide${fileNum}.xml.rels`, relsXml(slide.rels));
        }
        const rId = `rId${i + 1}`;
        presRels.push({ id: rId, target: `slides/slide${fileNum}.xml` });
    });
    if (presentation) {
        zip.file('ppt/presentation.xml', presentationXml(presRels.map((r) => r.id)));
        zip.file('ppt/_rels/presentation.xml.rels', relsXml(presRels));
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

describe('service/assistant/pptxAttachments.js', () => {
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

    it('labels each slide and puts the title first', async () => {
        const file = await buildPptx({
            slides: [
                { inner: body(['Body line one']) + title('Slide One Title') }
            ]
        });
        const { attachments, pageCount, truncated } = await extractPptxAttachments(file);
        const text = attachments[0].data;

        expect(truncated).toBe(false);
        expect(pageCount).toBe(1);
        expect(text).toContain('[Slide 1]');
        // title appears before the body even though it is authored second
        expect(text.indexOf('Slide One Title')).toBeLessThan(text.indexOf('Body line one'));
        expect(text.indexOf('[Slide 1]')).toBeLessThan(text.indexOf('Slide One Title'));
    });

    it('orders slides by sldIdLst, not by slide file name', async () => {
        // display order: slideA then slideB, but stored as slide2.xml, slide1.xml
        const file = await buildPptx({
            slides: [
                { inner: title('First Shown') },
                { inner: title('Second Shown') }
            ],
            order: [2, 1]
        });
        const { attachments } = await extractPptxAttachments(file);
        const text = attachments[0].data;
        expect(text.indexOf('First Shown')).toBeLessThan(text.indexOf('Second Shown'));
        expect(text.indexOf('[Slide 1]')).toBeLessThan(text.indexOf('[Slide 2]'));
    });

    it('falls back to numeric slide-name order without presentation.xml', async () => {
        const file = await buildPptx({
            slides: [
                { inner: title('Alpha') },
                { inner: title('Beta') }
            ],
            order: [1, 2],
            presentation: false
        });
        const { attachments, pageCount } = await extractPptxAttachments(file);
        expect(pageCount).toBe(2);
        const text = attachments[0].data;
        expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Beta'));
    });

    it('extracts tables as pipe-joined rows', async () => {
        const file = await buildPptx({
            slides: [
                { inner: title('Data') + tableShape([['a', 'b'], ['c', 'd']]) }
            ]
        });
        const { attachments } = await extractPptxAttachments(file);
        const text = attachments[0].data;
        expect(text).toContain('a | b');
        expect(text).toContain('c | d');
    });

    it('resolves blip images via slide rels with ../media normalization', async () => {
        const file = await buildPptx({
            slides: [
                {
                    inner: title('Pictures') + pic('rId2') + pic('rId3'),
                    rels: [
                        { id: 'rId2', target: '../media/image1.png' },
                        { id: 'rId3', target: '../media/image2.png' }
                    ]
                }
            ],
            media: {
                'ppt/media/image1.png': 'AAA',
                'ppt/media/image2.png': 'BBB'
            }
        });
        const { attachments } = await extractPptxAttachments(file);
        const images = attachments.filter((a) => a.kind === 'image');
        expect(images).toHaveLength(2);
        expect(images[0].name).toBe('deck.pptx (slide 1, figure 1)');
        expect(images[1].name).toBe('deck.pptx (slide 1, figure 2)');
        expect(new Set(attachments.map((a) => a.group))).toEqual(new Set(['deck.pptx']));
    });

    it('appends unreferenced media after slide-referenced figures', async () => {
        const file = await buildPptx({
            slides: [
                {
                    inner: pic('rId2'),
                    rels: [{ id: 'rId2', target: '../media/image1.png' }]
                }
            ],
            media: {
                'ppt/media/image1.png': 'AAA',
                'ppt/media/image9.png': 'ZZZ'
            }
        });
        const { attachments } = await extractPptxAttachments(file);
        const images = attachments.filter((a) => a.kind === 'image');
        expect(images).toHaveLength(2);
        expect(images[0].name).toBe('deck.pptx (slide 1, figure 1)');
        // unreferenced extra named as a bare figure, deduped (no double image1)
        expect(images[1].name).toBe('deck.pptx (figure 1)');
    });

    it('counts a failed EMF conversion as skipped', async () => {
        mockConvertEmf.mockResolvedValueOnce('data:image/png;base64,Zm9v');
        const file = await buildPptx({
            slides: [
                {
                    inner: pic('rId2'),
                    rels: [{ id: 'rId2', target: '../media/image1.emf' }]
                }
            ],
            media: { 'ppt/media/image1.emf': 'EMFBYTES' }
        });
        const { attachments, skippedImages } = await extractPptxAttachments(file);
        expect(attachments.filter((a) => a.kind === 'image')).toHaveLength(0);
        expect(skippedImages).toBe(1);
        expect(mockConvertEmf).toHaveBeenCalled();
    });

    it('caps images at maxImages', async () => {
        const media = {};
        const rels = [];
        let inner = '';
        for (let i = 1; i <= 5; i += 1) {
            media[`ppt/media/image${i}.png`] = 'AAA';
            rels.push({ id: `rId${i + 1}`, target: `../media/image${i}.png` });
            inner += pic(`rId${i + 1}`);
        }
        const file = await buildPptx({ slides: [{ inner, rels }], media });
        const { attachments } = await extractPptxAttachments(file, { maxImages: 3 });
        expect(attachments.filter((a) => a.kind === 'image')).toHaveLength(3);
    });

    it('chunks many slides into pending sections with a small budget', async () => {
        const slides = Array.from({ length: 12 }, (unused, i) => ({
            inner: title(`Slide title number ${i}`) + body([`content line for slide ${i}`])
        }));
        const file = await buildPptx({ slides });
        const { attachments, sections, truncated, pageCount } =
            await extractPptxAttachments(file, { chunkBudget: 200 });
        expect(pageCount).toBe(12);
        expect(sections).toBeGreaterThan(1);
        expect(truncated).toBe(false);
        const text = attachments[0];
        expect(text.data).toContain('[Slide 1]');
        expect(text.data).toContain('[Document continues: section 1');
        expect(text.pendingSections.length).toBe(sections - 1);
    });

    it('exposes one group per file', async () => {
        const file = await buildPptx({
            slides: [
                {
                    inner: title('T') + pic('rId2'),
                    rels: [{ id: 'rId2', target: '../media/image1.png' }]
                }
            ],
            media: { 'ppt/media/image1.png': 'AAA' }
        });
        const { attachments } = await extractPptxAttachments(file);
        expect(new Set(attachments.map((a) => a.group))).toEqual(new Set(['deck.pptx']));
    });
});
