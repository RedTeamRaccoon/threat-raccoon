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

        const { attachments, pageCount, truncated, sections } = await extractPdfAttachments(file);

        expect(pageCount).toBe(2);
        expect(truncated).toBe(false);
        expect(sections).toBe(1);
        expect(attachments).toHaveLength(3);

        const [text, img1, img2] = attachments;
        expect(text.kind).toBe('text');
        expect(text.name).toBe('design-spec.pdf');
        expect(text.data).toContain('[Page 1]');
        expect(text.data).toContain('hello world');
        expect(text.data).toContain('[Page 2]');
        // a doc that fits in one section carries no pending sections and no
        // continuation marker
        expect(text.pendingSections).toBeUndefined();
        expect(text.data).not.toContain('[Document continues');

        expect(img1).toEqual({
            kind: 'image',
            mediaType: 'image/jpeg',
            name: 'design-spec.pdf (page 1)',
            group: 'design-spec.pdf',
            data: 'data:image/jpeg;base64,RkFLRQ=='
        });
        expect(img2.name).toBe('design-spec.pdf (page 2)');
        // every part carries the same group so the composer shows ONE chip
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

    it('keeps extracting text past the image-page cap', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve(mockDoc([
                mockPage(['one']),
                mockPage(['two']),
                mockPage(['three'])
            ]))
        });

        const { attachments, truncated, textPages, imagePages } = await extractPdfAttachments(file, { maxPages: 2 });

        // the text covers EVERY page, so the document is NOT truncated; only
        // the page images stop at the cap
        expect(truncated).toBe(false);
        expect(imagePages).toBe(2);
        expect(textPages).toBe(3);
        expect(attachments).toHaveLength(3);
        expect(attachments[0].data).toContain('[Page 3]');
    });

    describe('chunking long documents', () => {
        // each page renders as the entry '[Page n]\n0123456789' = 19 bytes
        const tenCharPage = () => mockPage(['0123456789']);

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
            // section 1 carries pages 1-2 plus the continuation marker
            expect(text.data).toContain('[Page 1]');
            expect(text.data).toContain('[Page 2]');
            expect(text.data).not.toContain('[Page 3]');
            expect(text.data).toContain('[Document continues: section 1 of 2. Later sections will follow in this conversation.]');
            // section 2 rides along for the send pipeline
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
            // images are unaffected by the section cap
            expect(imagePages).toBe(10);
            expect(attachments).toHaveLength(11);

            const { pendingSections } = attachments[0];
            expect(pendingSections).toHaveLength(7);
            // the honest truncation note lives in the FINAL section's text
            const last = pendingSections[pendingSections.length - 1];
            expect(last).toMatchObject({ index: 8, total: 8, pageRange: '8-8' });
            expect(last.text).toContain('[Document truncated: text included for the first 8 of 10 pages');
            expect(last.text).toContain('page images for the first 10');
        });
    });
});
