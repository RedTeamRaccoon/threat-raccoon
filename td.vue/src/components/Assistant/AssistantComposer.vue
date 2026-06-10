<template>
    <div class="td-assistant-composer">
        <div v-if="attachments.length" class="td-assistant-chips">
            <b-badge
                v-for="(att, idx) in attachments"
                :key="idx"
                variant="info"
                class="mr-1 mb-1 td-assistant-chip"
            >
                <font-awesome-icon :icon="att.kind === 'image' ? 'image' : 'file-alt'" class="mr-1" />
                {{ att.name }}
                <span class="td-assistant-chip-remove" @click="removeAttachment(idx)">&times;</span>
            </b-badge>
        </div>

        <div v-if="sizeWarning" class="td-assistant-warning">
            {{ $t('assistant.attachment.tooLarge') }}
        </div>

        <div v-if="pdfWarning" class="td-assistant-warning">
            {{ $t(`assistant.attachment.${pdfWarning}`) }}
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
                accept="text/*,image/*,application/pdf,.pdf,.json,.md,.txt"
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
                :disabled="!canSend || !text.trim()"
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

const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

const isPdf = (file) => file.type === 'application/pdf' || (/\.pdf$/iu).test(file.name || '');

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
            pdfWarning: ''
        };
    },
    computed: mapState({
        attachments: (state) => state.assistant.attachments
    }),
    methods: {
        submit() {
            if (this.busy || !this.canSend || !this.text.trim()) {
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
            try {
                const { attachments, truncated } = await extractPdfAttachments(file);
                attachments.forEach((attachment) => this.addAttachment(attachment));
                if (truncated) {
                    this.pdfWarning = 'pdfTruncated';
                }
            } catch (e) {
                console.error('PDF extraction failed', e);
                this.pdfWarning = 'pdfFailed';
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
        removeAttachment(idx) {
            this.$store.dispatch(assistantActions.removeAttachment, idx);
            this.sizeWarning = false;
            this.pdfWarning = '';
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
</style>
