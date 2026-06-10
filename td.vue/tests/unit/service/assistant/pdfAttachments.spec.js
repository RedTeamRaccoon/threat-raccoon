import { extractPdfAttachments } from '@/service/assistant/pdfAttachments.js';

const mockGetDocument = jest.fn();

jest.mock('pdfjs-dist/legacy/build/pdf', () => ({
    GlobalWorkerOptions: {},
    getDocument: (...args) => mockGetDocument(...args)
}));

jest.mock('pdfjs-dist/legacy/build/pdf.worker.entry', () => 'mock-worker-src');

const mockPage = (texts) => ({
    getTextContent: () => Promise.resolve({
        items: texts.map((str, idx) => ({ str, hasEOL: idx % 2 === 1 }))
    }),
    getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
    render: () => ({ promise: Promise.resolve() })
});

const mockDoc = (pages) => ({
    numPages: pages.length,
    getPage: (p) => Promise.resolve(pages[p - 1])
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

    beforeEach(() => {
        jest.clearAllMocks();
        // the jest config resets mock impls between tests, so (re)set them here
        fakeCanvas.getContext.mockReturnValue({});
        fakeCanvas.toDataURL.mockReturnValue('data:image/jpeg;base64,RkFLRQ==');
        realCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation(
            (tag) => (tag === 'canvas' ? fakeCanvas : realCreateElement(tag))
        );
    });

    afterEach(() => {
        document.createElement.mockRestore();
    });

    it('extracts text and one image per page', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['hello', 'world']),
                mockPage(['second', 'page'])
            ]))
        });

        const { attachments, pageCount, truncated } = await extractPdfAttachments(file);

        expect(pageCount).toBe(2);
        expect(truncated).toBe(false);
        expect(attachments).toHaveLength(3);

        const [text, img1, img2] = attachments;
        expect(text.kind).toBe('text');
        expect(text.name).toBe('design-spec.pdf');
        expect(text.data).toContain('[Page 1]');
        expect(text.data).toContain('hello world');
        expect(text.data).toContain('[Page 2]');

        expect(img1).toEqual({
            kind: 'image',
            mediaType: 'image/jpeg',
            name: 'design-spec.pdf (page 1)',
            data: 'data:image/jpeg;base64,RkFLRQ=='
        });
        expect(img2.name).toBe('design-spec.pdf (page 2)');
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

    it('truncates long documents and says so in the text attachment', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['one']),
                mockPage(['two']),
                mockPage(['three'])
            ]))
        });

        const { attachments, truncated } = await extractPdfAttachments(file, { maxPages: 2 });

        expect(truncated).toBe(true);
        // text + 2 page images only
        expect(attachments).toHaveLength(3);
        expect(attachments[0].data).toContain('Only the first 2 of 3 pages');
    });
});
