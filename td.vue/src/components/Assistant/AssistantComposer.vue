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

        <div v-if="pdfWarning" class="td-assistant-warning">
            {{ $t(`assistant.attachment.${pdfWarning}`, pdfWarningParams) }}
        </div>

        <div v-if="skippedWarningParams.count" class="td-assistant-warning">
            {{ $t('assistant.attachment.imagesSkipped', skippedWarningParams) }}
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

const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

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
            pdfWarning: '',
            pdfWarningParams: {},
            skippedWarningParams: {},
            pdfBusy: false
        };
    },
    computed: {
        ...mapState({
            attachments: (state) => state.assistant.attachments
        }),
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
        async readPdf(file) {
            // PDFs are binary: extract the text (CJK-capable) and render each
            // page as an image so the model can read embedded diagrams.
            this.pdfWarning = '';
            this.pdfWarningParams = {};
            this.skippedWarningParams = {};
            this.pdfBusy = true;
            try {
                const { attachments, truncated, textPages, imagePages, pageCount, sections } =
                    await extractPdfAttachments(file);
                attachments.forEach((attachment) => this.addAttachment(attachment));
                if (truncated) {
                    this.pdfWarning = 'pdfTruncated';
                    this.pdfWarningParams = { textPages, imagePages, total: pageCount };
                } else if (sections > 1) {
                    // the whole document fits, but it will be ingested in
                    // sections, one request after another
                    this.pdfWarning = 'pdfChunked';
                    this.pdfWarningParams = { sections };
                }
            } catch (e) {
                console.error('PDF extraction failed', e);
                this.pdfWarning = 'pdfFailed';
            } finally {
                this.pdfBusy = false;
            }
        },
        async readDocx(file) {
            // DOCX is OOXML (a ZIP): extract the text (headings/tables preserved)
            // and deliver every embedded figure to the vision model. Reuse the
            // PDF busy flag, spinner, and chunk/truncate notices since their
            // wording is generic.
            this.pdfWarning = '';
            this.pdfWarningParams = {};
            this.skippedWarningParams = {};
            this.pdfBusy = true;
            try {
                const { attachments, truncated, textPages, imagePages, pageCount, sections, skippedImages } =
                    await extractDocxAttachments(file);
                attachments.forEach((attachment) => this.addAttachment(attachment));
                if (truncated) {
                    this.pdfWarning = 'pdfTruncated';
                    this.pdfWarningParams = { textPages, imagePages, total: pageCount };
                } else if (sections > 1) {
                    this.pdfWarning = 'pdfChunked';
                    this.pdfWarningParams = { sections };
                }
                if (skippedImages > 0) {
                    // a second, small notice stacks below the chunk/truncate one
                    this.skippedWarningParams = { count: skippedImages };
                }
            } catch (e) {
                console.error('DOCX extraction failed', e);
                this.pdfWarning = 'pdfFailed';
            } finally {
                this.pdfBusy = false;
            }
        },
        async readPptx(file) {
            // PPTX is OOXML (a ZIP): extract each slide's text (title/tables
            // preserved) and deliver every embedded figure to the vision model.
            // Reuse the PDF busy flag, spinner, and chunk/truncate/skip notices
            // since their wording is generic.
            this.pdfWarning = '';
            this.pdfWarningParams = {};
            this.skippedWarningParams = {};
            this.pdfBusy = true;
            try {
                const { attachments, truncated, textPages, imagePages, pageCount, sections, skippedImages } =
                    await extractPptxAttachments(file);
                attachments.forEach((attachment) => this.addAttachment(attachment));
                if (truncated) {
                    this.pdfWarning = 'pdfTruncated';
                    this.pdfWarningParams = { textPages, imagePages, total: pageCount };
                } else if (sections > 1) {
                    this.pdfWarning = 'pdfChunked';
                    this.pdfWarningParams = { sections };
                }
                if (skippedImages > 0) {
                    // a second, small notice stacks below the chunk/truncate one
                    this.skippedWarningParams = { count: skippedImages };
                }
            } catch (e) {
                console.error('PPTX extraction failed', e);
                this.pdfWarning = 'pdfFailed';
            } finally {
                this.pdfBusy = false;
            }
        },
        onFilesSelected(files) {
            (files || []).forEach((file) => this.readFile(file));
            // reset the picker so the same file can be re-added later
            this.$nextTick(() => {
                this.files = [];
            });
        },
        onPaste(event) {
            const items = event.clipboardData && event.clipboardData.items;
            if (!items) {
                return;
            }
            for (let i = 0; i < items.length; i += 1) {
                if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    if (file) {
                        this.readFile(file);
                    }
                }
            }
        },
        removeChip(chip) {
            // remove every part of the chip, highest index first so the
            // remaining indices stay valid
            [...chip.indices].sort((a, b) => b - a).
                forEach((idx) => this.$store.dispatch(assistantActions.removeAttachment, idx));
            this.sizeWarning = false;
            this.pdfWarning = '';
            this.pdfWarningParams = {};
            this.skippedWarningParams = {};
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
