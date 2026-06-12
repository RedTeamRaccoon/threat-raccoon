<template>
    <div class="td-assistant-composer">
        <div v-if="attachmentChips.length" class="td-assistant-chips">
            <b-badge
                v-for="(chip, idx) in attachmentChips"
                :key="idx"
                variant="info"
                class="mr-1 mb-1 td-assistant-chip"
            >
                <font-awesome-icon :icon="chip.icon" class="mr-1" />
                {{ chip.label }}
                <span class="td-assistant-chip-remove" @click="removeChip(chip)">&times;</span>
            </b-badge>
        </div>

        <div v-if="pdfBusy" class="td-assistant-reading">
            <b-spinner small class="mr-1" />{{ $t('assistant.attachment.reading') }}
        </div>

        <div v-if="sizeWarning" class="td-assistant-warning">
            {{ $t('assistant.attachment.tooLarge') }}
        </div>

        <div
            v-for="(notice, idx) in notices"
            :key="idx"
            class="td-assistant-warning"
        >
            {{ notice.file }}: {{ $t(`assistant.attachment.${notice.key}`, notice.params) }}
        </div>

        <!-- native textarea: bootstrap-vue's b-form-textarea under @vue/compat
             does not reliably reflect programmatic value changes (the input
             kept its text after send), and native v-model is dependable -->
        <textarea
            id="assistant-input"
            v-model="text"
            class="form-control td-assistant-input"
            :placeholder="$t('assistant.composer.placeholder')"
            :disabled="busy"
            rows="3"
            @keydown.enter.exact.prevent="submit"
            @paste="onPaste"
        ></textarea>

        <div class="td-assistant-actions">
            <b-form-file
                v-model="files"
                multiple
                size="sm"
                :placeholder="$t('assistant.composer.attach')"
                :browse-text="$t('assistant.composer.browse')"
                accept="text/*,image/*,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.json,.md,.txt"
                class="td-assistant-file"
                @input="onFilesSelected"
            ></b-form-file>

            <b-button
                v-if="busy"
                variant="danger"
                size="sm"
                @click="$emit('stop')"
            >
                <font-awesome-icon icon="stop" class="mr-1" />{{ $t('assistant.composer.stop') }}
            </b-button>
            <b-button
                v-else
                variant="primary"
                size="sm"
                :disabled="!canSend || !text.trim() || pdfBusy"
                @click="submit"
            >
                <font-awesome-icon icon="paper-plane" class="mr-1" />{{ $t('assistant.composer.send') }}
            </b-button>
        </div>
    </div>
</template>

<script>
import { mapState } from 'vuex';

import assistantActions from '@/store/actions/assistant.js';
import { extractPdfAttachments } from '@/service/assistant/pdfAttachments.js';
import { extractDocxAttachments } from '@/service/assistant/docxAttachments.js';
import { extractPptxAttachments } from '@/service/assistant/pptxAttachments.js';

// Total attachment payload cap (base64 chars, ~1.33x raw bytes). Must stay
// comfortably under the server's 25mb /api/llm/complete body limit once JSON
// framing and the conversation itself ride on top.
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const isPdf = (file) => file.type === 'application/pdf' || (/\.pdf$/iu).test(file.name || '');
const isDocx = (file) => file.type === DOCX_MIME || (/\.docx$/iu).test(file.name || '');
const isPptx = (file) => file.type === PPTX_MIME || (/\.pptx$/iu).test(file.name || '');

export default {
    name: 'TdAssistantComposer',
    props: {
        busy: {
            type: Boolean,
            default: false
        },
        canSend: {
            type: Boolean,
            default: false
        }
    },
    data() {
        return {
            text: '',
            files: [],
            sizeWarning: false,
            // accumulating notices across a multi-file batch; each entry is
            // { file, key, params } and a single file may add up to two (one of
            // pdfTruncated|pdfChunked|pdfFailed, plus imagesSkipped)
            notices: [],
            // count of in-flight extractions: ALL must finish before the send
            // guard unlocks, so a counter (not a boolean) is required when more
            // than one file is read at once
            extracting: 0
        };
    },
    computed: {
        ...mapState({
            attachments: (state) => state.assistant.attachments
        }),
        // public name kept so the template/specs read it naturally; true while
        // any extraction is still running
        pdfBusy() {
            return this.extracting > 0;
        },
        // one chip per logical attachment: parts that share a `group` (the
        // page text + page images of one PDF) collapse into a single chip
        attachmentChips() {
            const chips = [];
            const groups = new Map();
            this.attachments.forEach((att, idx) => {
                if (!att.group) {
                    chips.push({
                        label: att.name,
                        icon: att.kind === 'image' ? 'image' : 'file-alt',
                        indices: [idx]
                    });
                    return;
                }
                if (!groups.has(att.group)) {
                    const chip = { group: att.group, icon: 'file-pdf', indices: [], pages: 0 };
                    groups.set(att.group, chip);
                    chips.push(chip);
                }
                const chip = groups.get(att.group);
                chip.indices.push(idx);
                if (att.kind === 'image') {
                    chip.pages += 1;
                }
                chip.label = `${att.group} (${this.$t('assistant.attachment.pages', { count: chip.pages })})`;
            });
            return chips;
        }
    },
    methods: {
        submit() {
            if (this.busy || !this.canSend || this.pdfBusy || !this.text.trim()) {
                return;
            }
            // clear BEFORE emitting so the input flushes even if a send
            // listener throws synchronously
            const message = this.text.trim();
            this.text = '';
            // the store clears the staged attachments after the run; drop their
            // stale notices too so they do not linger over the next batch
            this.notices = [];
            this.$emit('send', message);
        },
        totalBytes() {
            return this.attachments.reduce((sum, a) => sum + (a.data ? a.data.length : 0), 0);
        },
        addAttachment(attachment) {
            if (this.totalBytes() + (attachment.data ? attachment.data.length : 0) > MAX_TOTAL_BYTES) {
                this.sizeWarning = true;
                return;
            }
            this.sizeWarning = false;
            this.$store.dispatch(assistantActions.addAttachment, attachment);
        },
        readFile(file) {
            if (isPdf(file)) {
                return this.readPdf(file);
            }
            if (isDocx(file)) {
                return this.readDocx(file);
            }
            if (isPptx(file)) {
                return this.readPptx(file);
            }
            const isImage = file.type && file.type.startsWith('image/');
            const reader = new FileReader();
            reader.onload = () => {
                this.addAttachment({
                    kind: isImage ? 'image' : 'text',
                    mediaType: file.type || 'text/plain',
                    name: file.name || (isImage ? 'pasted-image' : 'document'),
                    data: reader.result
                });
            };
            if (isImage) {
                reader.readAsDataURL(file);
            } else {
                reader.readAsText(file);
            }
        },
        // record one structured-document notice (truncate/chunk) for `file`,
        // tagging it with the file name so a multi-file batch can show whose
        // notice is whose. A file contributes at most one of these.
        addDocNotice(file, { truncated, textPages, imagePages, pageCount, sections }) {
            const name = (file && file.name) || 'document';
            if (truncated) {
                this.notices.push({
                    file: name,
                    key: 'pdfTruncated',
                    params: { textPages, imagePages, total: pageCount }
                });
            } else if (sections > 1) {
                // the whole document fits, but it will be ingested in
                // sections, one request after another
                this.notices.push({ file: name, key: 'pdfChunked', params: { sections } });
            }
        },
        addSkippedNotice(file, skippedImages) {
            if (skippedImages > 0) {
                // a second, small notice stacks below the chunk/truncate one
                this.notices.push({
                    file: (file && file.name) || 'document',
                    key: 'imagesSkipped',
                    params: { count: skippedImages }
                });
            }
        },
        addFailedNotice(file) {
            this.notices.push({
                file: (file && file.name) || 'document',
                key: 'pdfFailed',
                params: {}
            });
        },
        async readPdf(file) {
            // PDFs are binary: extract the text (CJK-capable) and render each
            // page as an image so the model can read embedded diagrams.
            this.extracting += 1;
            try {
                const result = await extractPdfAttachments(file);
                result.attachments.forEach((attachment) => this.addAttachment(attachment));
                this.addDocNotice(file, result);
            } catch (e) {
                console.error('PDF extraction failed', e);
                this.addFailedNotice(file);
            } finally {
                this.extracting -= 1;
            }
        },
        async readDocx(file) {
            // DOCX is OOXML (a ZIP): extract the text (headings/tables preserved)
            // and deliver every embedded figure to the vision model. Reuse the
            // chunk/truncate/skip notices since their wording is generic.
            this.extracting += 1;
            try {
                const result = await extractDocxAttachments(file);
                result.attachments.forEach((attachment) => this.addAttachment(attachment));
                this.addDocNotice(file, result);
                this.addSkippedNotice(file, result.skippedImages);
            } catch (e) {
                console.error('DOCX extraction failed', e);
                this.addFailedNotice(file);
            } finally {
                this.extracting -= 1;
            }
        },
        async readPptx(file) {
            // PPTX is OOXML (a ZIP): extract each slide's text (title/tables
            // preserved) and deliver every embedded figure to the vision model.
            // Reuse the chunk/truncate/skip notices since their wording is generic.
            this.extracting += 1;
            try {
                const result = await extractPptxAttachments(file);
                result.attachments.forEach((attachment) => this.addAttachment(attachment));
                this.addDocNotice(file, result);
                this.addSkippedNotice(file, result.skippedImages);
            } catch (e) {
                console.error('PPTX extraction failed', e);
                this.addFailedNotice(file);
            } finally {
                this.extracting -= 1;
            }
        },
        async onFilesSelected(files) {
            // a fresh batch: drop the previous batch's notices, then process the
            // files SEQUENTIALLY so several large canvas-heavy PDFs do not spike
            // memory and attachment/figure order stays deterministic
            this.notices = [];
            for (const file of (files || [])) {
                await this.readFile(file);
            }
            // reset the picker so the same file can be re-added later
            this.$nextTick(() => {
                this.files = [];
            });
        },
        async onPaste(event) {
            const items = event.clipboardData && event.clipboardData.items;
            if (!items) {
                return;
            }
            // a fresh batch: same reset + sequential processing as the picker path
            this.notices = [];
            const pasted = [];
            for (let i = 0; i < items.length; i += 1) {
                if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    if (file) {
                        pasted.push(file);
                    }
                }
            }
            for (const file of pasted) {
                await this.readFile(file);
            }
        },
        removeChip(chip) {
            // remove every part of the chip, highest index first so the
            // remaining indices stay valid
            [...chip.indices].sort((a, b) => b - a).
                forEach((idx) => this.$store.dispatch(assistantActions.removeAttachment, idx));
            this.sizeWarning = false;
            this.notices = [];
        }
    }
};
</script>

<style lang="scss" scoped>
.td-assistant-composer {
    border-top: 1px solid #ddd;
    padding-top: 8px;
}
.td-assistant-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
    gap: 8px;
}
.td-assistant-file {
    flex: 1;
    min-width: 0;
}
.td-assistant-chip-remove {
    cursor: pointer;
    margin-left: 4px;
    font-weight: bold;
}
.td-assistant-warning {
    color: #b00;
    font-size: 12px;
    margin-bottom: 4px;
}
.td-assistant-reading {
    color: #888;
    font-size: 12px;
    margin-bottom: 4px;
}
</style>
