import { extractPdfAttachments } from '@/service/assistant/pdfAttachments.js';

const mockGetDocument = jest.fn();

// distinct numeric op constants for the mock (real values don't matter, only
// that they're distinct and stable across the module under test)
const OPS = {
    fill: 22,
    stroke: 20,
    fillStroke: 24,
    eoFill: 23,
    closePathStroke: 21,
    closePathFillStroke: 26,
    constructPath: 91,
    showText: 44,
    showSpacedText: 45,
    nextLineShowText: 46,
    nextLineSetSpacingShowText: 47,
    paintImageXObject: 85,
    paintImageMaskXObject: 83
};

jest.mock('pdfjs-dist/legacy/build/pdf', () => ({
    GlobalWorkerOptions: {},
    OPS: {
        fill: 22,
        stroke: 20,
        fillStroke: 24,
        eoFill: 23,
        closePathStroke: 21,
        closePathFillStroke: 26,
        constructPath: 91,
        showText: 44,
        showSpacedText: 45,
        nextLineShowText: 46,
        nextLineSetSpacingShowText: 47,
        paintImageXObject: 85,
        paintImageMaskXObject: 83
    },
    getDocument: (...args) => mockGetDocument(...args)
}));

jest.mock('pdfjs-dist/legacy/build/pdf.worker.entry', () => 'mock-worker-src');

// Build an operator list from a compact spec. `images` is an array of
// { name, width, height } painted via paintImageXObject in order; `paths` and
// `texts` are op counts.
const opList = ({ images = [], paths = 0, texts = 0 } = {}) => {
    const fnArray = [];
    const argsArray = [];
    for (const img of images) {
        fnArray.push(OPS.paintImageXObject);
        argsArray.push([img.name]);
    }
    for (let i = 0; i < paths; i += 1) {
        fnArray.push(OPS.fill);
        argsArray.push([]);
    }
    for (let i = 0; i < texts; i += 1) {
        fnArray.push(OPS.showText);
        argsArray.push([[]]);
    }
    return { fnArray, argsArray };
};

// A page mock. `graphics` (optional) gives { images, paths, texts } for the
// operator list plus an `objs` map of name -> resolved image object (or a
// special value to simulate failure). Legacy text-only tests pass no graphics
// but we default them to one path op so they stay "graphical" and keep a render.
const mockPage = (texts, graphics) => {
    const g = graphics || { images: [], paths: 1, texts: 0, objs: {} };
    const objs = g.objs || {};
    return {
        getTextContent: () => Promise.resolve({
            items: texts.map((str, idx) => ({ str, hasEOL: idx % 2 === 1 }))
        }),
        getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
        render: () => ({ promise: Promise.resolve() }),
        getOperatorList: () => Promise.resolve(
            opList({ images: g.images || [], paths: g.paths || 0, texts: g.texts || 0 })
        ),
        objs: {
            get: (name, cb) => {
                const entry = objs[name];
                if (entry === 'throw') {
                    throw new Error('Requesting object that isn\'t resolved yet');
                }
                cb(entry);
            }
        }
    };
};

const mockDoc = (pages) => ({
    numPages: pages.length,
    getPage: (p) => Promise.resolve(pages[p - 1])
});

// a resolved image object backed by raw RGB data of the given size
const rgbImage = (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 3)
});

describe('service/assistant/pdfAttachments.js', () => {
    const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: jest.fn(),
        toDataURL: jest.fn()
    };
    const file = {
        name: 'design-spec.pdf',
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
    };
    let realCreateElement;

    // each canvas instance reports its own width/height in toDataURL so stitched
    // figures encode their combined size and differently-sized figures don't
    // collide in the cross-page dedupe
    const freshCanvas = () => {
        const canvas = { width: 0, height: 0 };
        canvas.getContext = fakeCanvas.getContext;
        canvas.toDataURL = (type) => `data:${type || 'image/jpeg'};${canvas.width}x${canvas.height}`;
        return canvas;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // the jest config resets mock impls between tests, so (re)set them here
        fakeCanvas.getContext.mockReturnValue({
            drawImage: jest.fn(),
            putImageData: jest.fn()
        });
        fakeCanvas.toDataURL.mockReturnValue('data:image/jpeg;base64,RkFLRQ==');
        realCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation(
            (tag) => (tag === 'canvas' ? freshCanvas() : realCreateElement(tag))
        );
    });

    afterEach(() => {
        document.createElement.mockRestore();
    });

    it('extracts text and renders graphical pages', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['hello', 'world']),
                mockPage(['second', 'page'])
            ]))
        });

        const { attachments, pageCount, truncated, sections, imagePages } = await extractPdfAttachments(file);

        expect(pageCount).toBe(2);
        expect(truncated).toBe(false);
        expect(sections).toBe(1);
        // both legacy pages have a path op -> graphical -> rendered
        expect(imagePages).toBe(2);
        expect(attachments).toHaveLength(3);

        const [text, img1, img2] = attachments;
        expect(text.kind).toBe('text');
        expect(text.name).toBe('design-spec.pdf');
        expect(text.data).toContain('[Page 1]');
        expect(text.data).toContain('hello world');
        expect(text.data).toContain('[Page 2]');
        expect(text.pendingSections).toBeUndefined();
        expect(text.data).not.toContain('[Document continues');

        expect(img1).toMatchObject({
            kind: 'image',
            mediaType: 'image/jpeg',
            name: 'design-spec.pdf (page 1)',
            group: 'design-spec.pdf'
        });
        expect(img2.name).toBe('design-spec.pdf (page 2)');
        expect(new Set(attachments.map((a) => a.group))).toEqual(new Set(['design-spec.pdf']));
    });

    it('requests CJK cMaps so non-latin text extracts correctly', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([mockPage(['你好'])]))
        });

        await extractPdfAttachments(file);

        const args = mockGetDocument.mock.calls[0][0];
        expect(args.cMapUrl).toContain('pdfjs/cmaps/');
        expect(args.cMapPacked).toBe(true);
        expect(args.standardFontDataUrl).toContain('pdfjs/standard_fonts/');
    });

    it('does NOT render a pure-text page (text-only -> no image)', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['just text here'], { images: [], paths: 0, texts: 5, objs: {} })
            ]))
        });

        const { attachments, imagePages, figures } = await extractPdfAttachments(file);

        expect(imagePages).toBe(0);
        expect(figures).toBe(0);
        // only the text attachment, no image
        expect(attachments).toHaveLength(1);
        expect(attachments[0].kind).toBe('text');
    });

    it('renders a graphical page (high path ratio, no images)', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['chart'], { images: [], paths: 10, texts: 2, objs: {} })
            ]))
        });

        const { attachments, imagePages, figures } = await extractPdfAttachments(file);

        expect(imagePages).toBe(1);
        expect(figures).toBe(0);
        expect(attachments).toHaveLength(2);
        expect(attachments[1].name).toBe('design-spec.pdf (page 1)');
    });

    it('extracts an embedded figure with "(page N, figure 1)" naming', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['diagram'], {
                    images: [{ name: 'img1' }],
                    paths: 0,
                    texts: 3,
                    objs: { img1: rgbImage(800, 600) }
                })
            ]))
        });

        const { attachments, figures } = await extractPdfAttachments(file);

        expect(figures).toBe(1);
        const fig = attachments.find((a) => a.name.includes('figure 1'));
        expect(fig).toBeDefined();
        expect(fig.name).toBe('design-spec.pdf (page 1, figure 1)');
        expect(fig.group).toBe('design-spec.pdf');
        // the page also has an image op -> graphical -> page also rendered
        const render = attachments.find((a) => a.name === 'design-spec.pdf (page 1)');
        expect(render).toBeDefined();
    });

    it('skips a tiny image (below the size floor)', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['icon'], {
                    images: [{ name: 'tiny' }],
                    paths: 0,
                    texts: 3,
                    objs: { tiny: rgbImage(50, 50) }
                })
            ]))
        });

        const { figures, attachments } = await extractPdfAttachments(file);

        expect(figures).toBe(0);
        expect(attachments.find((a) => a.name.includes('figure'))).toBeUndefined();
    });

    it('dedupes a cross-page duplicate figure (same dataURL)', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['p1'], {
                    images: [{ name: 'logo' }],
                    paths: 0,
                    texts: 3,
                    objs: { logo: rgbImage(400, 400) }
                }),
                mockPage(['p2'], {
                    images: [{ name: 'logo' }],
                    paths: 0,
                    texts: 3,
                    objs: { logo: rgbImage(400, 400) }
                })
            ]))
        });

        const { figures, attachments } = await extractPdfAttachments(file);

        // identical 400x400 -> identical dataURL -> only the first kept
        expect(figures).toBe(1);
        const figs = attachments.filter((a) => a.name.includes('figure'));
        expect(figs).toHaveLength(1);
        expect(figs[0].name).toBe('design-spec.pdf (page 1, figure 1)');
    });

    it('stitches a strip group into a single figure', async () => {
        // 4 consecutive equal-width short strips -> one stitched figure.
        // Stitched height 4*40 = 160 >= floor, width 600.
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['sliced picture'], {
                    images: [
                        { name: 's1' },
                        { name: 's2' },
                        { name: 's3' },
                        { name: 's4' }
                    ],
                    paths: 0,
                    texts: 3,
                    objs: {
                        s1: rgbImage(600, 40),
                        s2: rgbImage(600, 40),
                        s3: rgbImage(600, 40),
                        s4: rgbImage(600, 40)
                    }
                })
            ]))
        });

        const { figures, attachments } = await extractPdfAttachments(file);

        expect(figures).toBe(1);
        const figs = attachments.filter((a) => a.name.includes('figure'));
        expect(figs).toHaveLength(1);
        // the stitched dataURL encodes the combined 600x160 canvas size
        expect(figs[0].data).toContain('600x160');
    });

    it('image-dense page (>8 image ops) yields figures only, no page render', async () => {
        const images = [];
        const objs = {};
        for (let i = 0; i < 9; i += 1) {
            // distinct sizes so they don't dedupe and none is a strip group
            images.push({ name: `d${i}` });
            objs[`d${i}`] = rgbImage(300, 200 + i * 5);
        }
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['dense'], { images, paths: 0, texts: 1, objs })
            ]))
        });

        const { figures, imagePages, attachments } = await extractPdfAttachments(file);

        // image-dense + figures extracted -> NO full-page render
        expect(imagePages).toBe(0);
        // capped at MAX_FIGURES_PER_PAGE (6)
        expect(figures).toBe(6);
        expect(attachments.find((a) => a.name === 'design-spec.pdf (page 1)')).toBeUndefined();
    });

    it('objs.get failure still yields the page text and render', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['resilient page'], {
                    images: [{ name: 'broken' }],
                    paths: 0,
                    texts: 3,
                    objs: { broken: 'throw' }
                })
            ]))
        });

        const { attachments, figures, imagePages } = await extractPdfAttachments(file);

        // no figure extracted, but text is present and the page (has an image
        // op -> graphical) is still rendered
        expect(figures).toBe(0);
        expect(imagePages).toBe(1);
        expect(attachments[0].data).toContain('resilient page');
        expect(attachments.find((a) => a.name === 'design-spec.pdf (page 1)')).toBeDefined();
    });

    it('counts extracted figures in the `figures` field', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['a'], {
                    images: [{ name: 'f1' }],
                    paths: 0,
                    texts: 2,
                    objs: { f1: rgbImage(500, 400) }
                }),
                mockPage(['b'], {
                    images: [{ name: 'f2' }],
                    paths: 0,
                    texts: 2,
                    objs: { f2: rgbImage(700, 500) }
                })
            ]))
        });

        const { figures } = await extractPdfAttachments(file);
        expect(figures).toBe(2);
    });

    describe('chunking long documents', () => {
        // each page renders as the entry '[Page n]\n0123456789' = 19 bytes; give
        // it a path op so the page stays graphical and keeps its render (so the
        // legacy image-count expectations still hold)
        const tenCharPage = () => mockPage(['0123456789'], { images: [], paths: 1, texts: 0, objs: {} });

        it('splits the text into sections that respect the chunk budget', async () => {
            mockGetDocument.mockReturnValue({
                promise: Promise.resolve(mockDoc([tenCharPage(), tenCharPage(), tenCharPage()]))
            });

            // 40 bytes fits two 19-byte page entries, not three
            const { attachments, sections, truncated, textPages } =
                await extractPdfAttachments(file, { chunkBudget: 40 });

            expect(sections).toBe(2);
            expect(truncated).toBe(false);
            expect(textPages).toBe(3);

            const text = attachments[0];
            expect(text.data).toContain('[Page 1]');
            expect(text.data).toContain('[Page 2]');
            expect(text.data).not.toContain('[Page 3]');
            expect(text.data).toContain('[Document continues: section 1 of 2. Later sections will follow in this conversation.]');
            expect(text.pendingSections).toHaveLength(1);
            expect(text.pendingSections[0]).toMatchObject({ index: 2, total: 2, pageRange: '3-3' });
            expect(text.pendingSections[0].text).toContain('[Page 3]');
        });

        it('caps the number of sections and marks the document truncated', async () => {
            // 10 pages, budget so small every page becomes its own section:
            // the 8-section cap drops pages 9 and 10
            mockGetDocument.mockReturnValue({
                promise: Promise.resolve(mockDoc(Array.from({ length: 10 }, tenCharPage)))
            });

            const { attachments, sections, truncated, textPages, imagePages, pageCount } =
                await extractPdfAttachments(file, { chunkBudget: 1 });

            expect(pageCount).toBe(10);
            expect(sections).toBe(8);
            expect(truncated).toBe(true);
            expect(textPages).toBe(8);
            // every page is graphical (path op) and within the 20-image budget,
            // so all 10 render
            expect(imagePages).toBe(10);
            expect(attachments).toHaveLength(11);

            const { pendingSections } = attachments[0];
            expect(pendingSections).toHaveLength(7);
            const last = pendingSections[pendingSections.length - 1];
            expect(last).toMatchObject({ index: 8, total: 8, pageRange: '8-8' });
            expect(last.text).toContain('[Document truncated: text included for the first 8 of 10 pages');
            expect(last.text).toContain('10 graphical page(s)');
        });
    });

    it('enforces the TOTAL image budget by dropping later pages', async () => {
        // 3 graphical pages, budget 2 -> only the first 2 renders kept
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['one'], { images: [], paths: 2, texts: 0, objs: {} }),
                mockPage(['two'], { images: [], paths: 2, texts: 0, objs: {} }),
                mockPage(['three'], { images: [], paths: 2, texts: 0, objs: {} })
            ]))
        });

        const { attachments, imagePages, textPages, truncated } =
            await extractPdfAttachments(file, { maxPages: 2 });

        expect(truncated).toBe(false);
        expect(textPages).toBe(3);
        expect(imagePages).toBe(2);
        expect(attachments).toHaveLength(3);
        expect(attachments[0].data).toContain('[Page 3]');
        expect(attachments.find((a) => a.name === 'design-spec.pdf (page 3)')).toBeUndefined();
    });
});
