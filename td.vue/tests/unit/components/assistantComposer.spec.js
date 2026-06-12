import { BootstrapVue } from 'bootstrap-vue';
import { mount, createLocalVue } from '@vue/test-utils';

import TdAssistantComposer from '@/components/Assistant/AssistantComposer.vue';
import { extractPdfAttachments } from '@/service/assistant/pdfAttachments.js';
import { extractDocxAttachments } from '@/service/assistant/docxAttachments.js';
import { extractPptxAttachments } from '@/service/assistant/pptxAttachments.js';

jest.mock('@/service/assistant/pdfAttachments.js', () => ({ extractPdfAttachments: jest.fn() }));
jest.mock('@/service/assistant/docxAttachments.js', () => ({ extractDocxAttachments: jest.fn() }));
jest.mock('@/service/assistant/pptxAttachments.js', () => ({ extractPptxAttachments: jest.fn() }));

describe('components/Assistant/AssistantComposer.vue', () => {
    const mountComposer = (propsData = { busy: false, canSend: true }, attachments = []) => {
        const store = {
            state: { assistant: { attachments } },
            dispatch: jest.fn()
        };
        const localVue = createLocalVue();
        localVue.use(BootstrapVue);
        const wrapper = mount(TdAssistantComposer, {
            localVue,
            propsData,
            mocks: { $t: (t) => t, $store: store }
        });
        return { wrapper, store };
    };

    it('emits send with the trimmed message', async () => {
        const { wrapper } = mountComposer();
        await wrapper.find('#assistant-input').setValue('  build a model  ');
        wrapper.vm.submit();
        expect(wrapper.emitted('send')).toEqual([['build a model']]);
    });

    it('clears the input after sending', async () => {
        const { wrapper } = mountComposer();
        const input = wrapper.find('#assistant-input');
        await input.setValue('build a model');
        wrapper.vm.submit();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.text).toBe('');
        expect(input.element.value).toBe('');
    });

    it('clears the input even when the send handler throws', async () => {
        const { wrapper } = mountComposer();
        wrapper.vm.$on('send', () => { throw new Error('listener blew up'); });
        await wrapper.find('#assistant-input').setValue('boom');
        expect(() => wrapper.vm.submit()).toThrow();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.text).toBe('');
    });

    it('does not send when empty or busy', async () => {
        const { wrapper } = mountComposer({ busy: true, canSend: true });
        await wrapper.setData({ text: 'queued' });
        wrapper.vm.submit();
        expect(wrapper.emitted('send')).toBeUndefined();
    });

    it('does not send while a PDF is still being read', async () => {
        const { wrapper } = mountComposer();
        // pdfBusy is now a computed over the in-flight extraction counter
        await wrapper.setData({ text: 'go', extracting: 1 });
        expect(wrapper.vm.pdfBusy).toBe(true);
        wrapper.vm.submit();
        expect(wrapper.emitted('send')).toBeUndefined();
    });

    describe('pdf extraction notices', () => {
        const pdfFile = { name: 'spec.pdf', type: 'application/pdf' };

        it('shows the chunked notice when the doc splits into sections without truncation', async () => {
            extractPdfAttachments.mockResolvedValue({
                attachments: [],
                truncated: false,
                sections: 3,
                textPages: 30,
                imagePages: 20,
                pageCount: 30
            });
            const { wrapper } = mountComposer();
            await wrapper.vm.readPdf(pdfFile);
            expect(wrapper.vm.notices).toEqual([
                { file: 'spec.pdf', key: 'pdfChunked', params: { sections: 3 } }
            ]);
        });

        it('keeps the truncation notice when pages were dropped', async () => {
            extractPdfAttachments.mockResolvedValue({
                attachments: [],
                truncated: true,
                sections: 8,
                textPages: 80,
                imagePages: 20,
                pageCount: 95
            });
            const { wrapper } = mountComposer();
            await wrapper.vm.readPdf(pdfFile);
            expect(wrapper.vm.notices).toEqual([
                { file: 'spec.pdf', key: 'pdfTruncated', params: { textPages: 80, imagePages: 20, total: 95 } }
            ]);
        });

        it('shows no notice for a short single-section doc', async () => {
            extractPdfAttachments.mockResolvedValue({
                attachments: [],
                truncated: false,
                sections: 1,
                textPages: 4,
                imagePages: 4,
                pageCount: 4
            });
            const { wrapper } = mountComposer();
            await wrapper.vm.readPdf(pdfFile);
            expect(wrapper.vm.notices).toEqual([]);
        });
    });

    describe('docx extraction routing and notices', () => {
        const docxFile = {
            name: 'spec.docx',
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };

        const ok = (over = {}) => ({
            attachments: [],
            truncated: false,
            sections: 1,
            textPages: 1,
            imagePages: 0,
            pageCount: 1,
            skippedImages: 0,
            ...over
        });

        it('routes a .docx file through readDocx, not the text reader', async () => {
            extractDocxAttachments.mockResolvedValue(ok());
            const { wrapper } = mountComposer();
            const spy = jest.spyOn(wrapper.vm, 'readDocx');
            wrapper.vm.readFile({ name: 'notes.docx' });
            expect(spy).toHaveBeenCalled();
            expect(extractDocxAttachments).toHaveBeenCalled();
        });

        it('shows the skipped-images notice when figures could not be converted', async () => {
            extractDocxAttachments.mockResolvedValue(ok({ skippedImages: 2 }));
            const { wrapper } = mountComposer();
            await wrapper.vm.readDocx(docxFile);
            expect(wrapper.vm.notices).toEqual([
                { file: 'spec.docx', key: 'imagesSkipped', params: { count: 2 } }
            ]);
        });

        it('stacks the chunked notice and the skipped notice together', async () => {
            extractDocxAttachments.mockResolvedValue(ok({ sections: 3, skippedImages: 1 }));
            const { wrapper } = mountComposer();
            await wrapper.vm.readDocx(docxFile);
            expect(wrapper.vm.notices).toEqual([
                { file: 'spec.docx', key: 'pdfChunked', params: { sections: 3 } },
                { file: 'spec.docx', key: 'imagesSkipped', params: { count: 1 } }
            ]);
        });

        it('shows the truncation notice for a truncated docx', async () => {
            extractDocxAttachments.mockResolvedValue(
                ok({ truncated: true, sections: 8, textPages: 8, imagePages: 20, pageCount: 40 })
            );
            const { wrapper } = mountComposer();
            await wrapper.vm.readDocx(docxFile);
            expect(wrapper.vm.notices).toEqual([
                { file: 'spec.docx', key: 'pdfTruncated', params: { textPages: 8, imagePages: 20, total: 40 } }
            ]);
        });

        it('shows no notice for a short single-section docx with no skips', async () => {
            extractDocxAttachments.mockResolvedValue(ok());
            const { wrapper } = mountComposer();
            await wrapper.vm.readDocx(docxFile);
            expect(wrapper.vm.notices).toEqual([]);
        });

        it('falls through to the generic text reader for an old binary .doc', () => {
            const { wrapper } = mountComposer();
            const docSpy = jest.spyOn(wrapper.vm, 'readDocx');
            const pdfSpy = jest.spyOn(wrapper.vm, 'readPdf');
            // a real Blob so the generic FileReader path does not crash
            const doc = new File(['x'], 'legacy.doc', { type: 'application/msword' });
            expect(() => wrapper.vm.readFile(doc)).not.toThrow();
            expect(docSpy).not.toHaveBeenCalled();
            expect(pdfSpy).not.toHaveBeenCalled();
        });
    });

    describe('pptx extraction routing and notices', () => {
        const pptxFile = {
            name: 'spec.pptx',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        };

        const ok = (over = {}) => ({
            attachments: [],
            truncated: false,
            sections: 1,
            textPages: 1,
            imagePages: 0,
            pageCount: 1,
            skippedImages: 0,
            ...over
        });

        it('routes a .pptx file through readPptx, not the text reader', async () => {
            extractPptxAttachments.mockResolvedValue(ok());
            const { wrapper } = mountComposer();
            const spy = jest.spyOn(wrapper.vm, 'readPptx');
            wrapper.vm.readFile({ name: 'deck.pptx' });
            expect(spy).toHaveBeenCalled();
            expect(extractPptxAttachments).toHaveBeenCalled();
        });

        it('shows the skipped-images notice when figures could not be converted', async () => {
            extractPptxAttachments.mockResolvedValue(ok({ skippedImages: 2 }));
            const { wrapper } = mountComposer();
            await wrapper.vm.readPptx(pptxFile);
            expect(wrapper.vm.notices).toEqual([
                { file: 'spec.pptx', key: 'imagesSkipped', params: { count: 2 } }
            ]);
        });

        it('stacks the chunked notice and the skipped notice together', async () => {
            extractPptxAttachments.mockResolvedValue(ok({ sections: 3, skippedImages: 1 }));
            const { wrapper } = mountComposer();
            await wrapper.vm.readPptx(pptxFile);
            expect(wrapper.vm.notices).toEqual([
                { file: 'spec.pptx', key: 'pdfChunked', params: { sections: 3 } },
                { file: 'spec.pptx', key: 'imagesSkipped', params: { count: 1 } }
            ]);
        });

        it('shows the truncation notice for a truncated pptx', async () => {
            extractPptxAttachments.mockResolvedValue(
                ok({ truncated: true, sections: 8, textPages: 8, imagePages: 20, pageCount: 40 })
            );
            const { wrapper } = mountComposer();
            await wrapper.vm.readPptx(pptxFile);
            expect(wrapper.vm.notices).toEqual([
                { file: 'spec.pptx', key: 'pdfTruncated', params: { textPages: 8, imagePages: 20, total: 40 } }
            ]);
        });

        it('shows no notice for a short single-section pptx with no skips', async () => {
            extractPptxAttachments.mockResolvedValue(ok());
            const { wrapper } = mountComposer();
            await wrapper.vm.readPptx(pptxFile);
            expect(wrapper.vm.notices).toEqual([]);
        });

        it('falls through to the generic text reader for an old binary .ppt', () => {
            const { wrapper } = mountComposer();
            const pptxSpy = jest.spyOn(wrapper.vm, 'readPptx');
            const pdfSpy = jest.spyOn(wrapper.vm, 'readPdf');
            // a real Blob so the generic FileReader path does not crash
            const ppt = new File(['x'], 'legacy.ppt', { type: 'application/vnd.ms-powerpoint' });
            expect(() => wrapper.vm.readFile(ppt)).not.toThrow();
            expect(pptxSpy).not.toHaveBeenCalled();
            expect(pdfSpy).not.toHaveBeenCalled();
        });
    });

    describe('attachment chips', () => {
        const pdfParts = [
            { kind: 'text', name: 'spec.pdf', group: 'spec.pdf', data: 'text' },
            { kind: 'image', name: 'spec.pdf (page 1)', group: 'spec.pdf', data: 'a' },
            { kind: 'image', name: 'spec.pdf (page 2)', group: 'spec.pdf', data: 'b' }
        ];

        it('collapses a multi-part PDF into one chip with a page count', () => {
            const { wrapper } = mountComposer(undefined, [
                { kind: 'text', name: 'notes.md', data: 'n' },
                ...pdfParts
            ]);
            const chips = wrapper.vm.attachmentChips;
            expect(chips).toHaveLength(2);
            expect(chips[0].label).toBe('notes.md');
            expect(chips[1].icon).toBe('file-pdf');
            expect(chips[1].indices).toEqual([1, 2, 3]);
            // $t mock returns the key, so the count shows via the key here
            expect(chips[1].label).toContain('spec.pdf');
        });

        it('removes every part of a grouped chip, highest index first', () => {
            const { wrapper, store } = mountComposer(undefined, [
                { kind: 'text', name: 'notes.md', data: 'n' },
                ...pdfParts
            ]);
            wrapper.vm.removeChip(wrapper.vm.attachmentChips[1]);
            const removals = store.dispatch.mock.calls.filter(([action]) => action === 'ASSISTANT_REMOVE_ATTACHMENT');
            expect(removals.map(([, idx]) => idx)).toEqual([3, 2, 1]);
        });
    });

    describe('multi-file batches', () => {
        const ok = (over = {}) => ({
            attachments: [],
            truncated: false,
            sections: 1,
            textPages: 1,
            imagePages: 0,
            pageCount: 1,
            ...over
        });

        // a promise whose resolution is controlled externally, so the test can
        // hold an extraction open and observe state mid-flight
        const deferred = () => {
            let resolve;
            const promise = new Promise((r) => { resolve = r; });
            return { promise, resolve };
        };

        it('stays busy until ALL in-flight extractions finish', async () => {
            const a = deferred();
            const b = deferred();
            extractPdfAttachments
                .mockReturnValueOnce(a.promise)
                .mockReturnValueOnce(b.promise);
            const { wrapper } = mountComposer();

            const p1 = wrapper.vm.readPdf({ name: 'a.pdf', type: 'application/pdf' });
            const p2 = wrapper.vm.readPdf({ name: 'b.pdf', type: 'application/pdf' });
            expect(wrapper.vm.pdfBusy).toBe(true);

            // first finisher must NOT unlock the send guard while the second runs
            a.resolve(ok());
            await p1;
            expect(wrapper.vm.pdfBusy).toBe(true);

            b.resolve(ok());
            await p2;
            expect(wrapper.vm.pdfBusy).toBe(false);
        });

        it('shows both notices with file names when two files produce notices', async () => {
            extractPdfAttachments
                .mockResolvedValueOnce(ok({ truncated: true, textPages: 5, imagePages: 2, pageCount: 9 }))
                .mockResolvedValueOnce(ok({ sections: 3 }));
            const { wrapper } = mountComposer();

            await wrapper.vm.onFilesSelected([
                { name: 'A.pdf', type: 'application/pdf' },
                { name: 'B.pdf', type: 'application/pdf' }
            ]);

            expect(wrapper.vm.notices).toEqual([
                { file: 'A.pdf', key: 'pdfTruncated', params: { textPages: 5, imagePages: 2, total: 9 } },
                { file: 'B.pdf', key: 'pdfChunked', params: { sections: 3 } }
            ]);
            const rows = wrapper.findAll('.td-assistant-warning');
            expect(rows.at(0).text()).toContain('A.pdf');
            expect(rows.at(1).text()).toContain('B.pdf');
        });

        it("keeps file A's failure notice when file B succeeds", async () => {
            extractPdfAttachments
                .mockRejectedValueOnce(new Error('boom'))
                .mockResolvedValueOnce(ok({ sections: 2 }));
            const { wrapper } = mountComposer();

            await wrapper.vm.onFilesSelected([
                { name: 'A.pdf', type: 'application/pdf' },
                { name: 'B.pdf', type: 'application/pdf' }
            ]);

            expect(wrapper.vm.notices).toEqual([
                { file: 'A.pdf', key: 'pdfFailed', params: {} },
                { file: 'B.pdf', key: 'pdfChunked', params: { sections: 2 } }
            ]);
        });

        it('processes the batch sequentially in selection order', async () => {
            const order = [];
            const a = deferred();
            const b = deferred();
            extractPdfAttachments.mockImplementation((file) => {
                order.push(file.name);
                return file.name === 'A.pdf' ? a.promise : b.promise;
            });
            const { wrapper } = mountComposer();

            const batch = wrapper.vm.onFilesSelected([
                { name: 'A.pdf', type: 'application/pdf' },
                { name: 'B.pdf', type: 'application/pdf' }
            ]);

            // only the first file's extractor has been invoked; the second waits
            // for the first to settle
            expect(order).toEqual(['A.pdf']);
            a.resolve(ok());
            await Promise.resolve();
            await Promise.resolve();
            expect(order).toEqual(['A.pdf', 'B.pdf']);
            b.resolve(ok());
            await batch;
        });

        it('clears the previous batch notices when a new batch begins', async () => {
            extractPdfAttachments.mockResolvedValue(ok({ sections: 3 }));
            const { wrapper } = mountComposer();
            await wrapper.vm.onFilesSelected([{ name: 'A.pdf', type: 'application/pdf' }]);
            expect(wrapper.vm.notices).toHaveLength(1);

            extractPdfAttachments.mockResolvedValue(ok());
            await wrapper.vm.onFilesSelected([{ name: 'B.pdf', type: 'application/pdf' }]);
            expect(wrapper.vm.notices).toEqual([]);
        });
    });
});
