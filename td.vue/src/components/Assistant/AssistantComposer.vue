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

        <b-form-textarea
            id="assistant-input"
            v-model="text"
            :placeholder="$t('assistant.composer.placeholder')"
            :disabled="busy"
            rows="2"
            max-rows="6"
            @keydown.enter.exact.prevent="submit"
            @paste="onPaste"
        ></b-form-textarea>

        <div class="td-assistant-actions">
            <b-form-file
                v-model="files"
                multiple
                size="sm"
                :placeholder="$t('assistant.composer.attach')"
                :browse-text="$t('assistant.composer.browse')"
                accept="text/*,image/*,.json,.md,.txt"
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

const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

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
            sizeWarning: false
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
            this.$emit('send', this.text.trim());
            this.text = '';
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
