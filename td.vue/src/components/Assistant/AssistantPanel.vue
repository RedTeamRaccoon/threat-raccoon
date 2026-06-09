<template>
    <b-card no-body class="td-assistant-panel">
        <template #header>
            <div class="td-assistant-header">
                <span class="td-assistant-title">
                    <font-awesome-icon icon="robot" class="mr-1" />{{ $t('assistant.title') }}
                </span>
                <span class="td-assistant-header-actions">
                    <b-button
                        size="sm"
                        variant="outline-secondary"
                        :title="$t('assistant.clear')"
                        :disabled="busy || !messages.length"
                        @click="clear"
                    >
                        <font-awesome-icon icon="trash" />
                    </b-button>
                    <b-button
                        size="sm"
                        variant="outline-secondary"
                        :title="$t('assistant.close')"
                        @click="$emit('close')"
                    >
                        <font-awesome-icon icon="times" />
                    </b-button>
                </span>
            </div>
        </template>

        <div v-if="!aiConfig.enabled" class="td-assistant-disabled">
            {{ $t('assistant.unavailable') }}
        </div>

        <div v-else class="td-assistant-body">
            <div class="td-assistant-selectors">
                <b-form-select
                    v-model="selectedProvider"
                    :options="providerOptions"
                    size="sm"
                    :disabled="busy"
                    @change="onProviderChange"
                ></b-form-select>
                <b-form-select
                    v-model="selectedModel"
                    :options="modelOptions"
                    size="sm"
                    :disabled="busy"
                    @change="onModelChange"
                ></b-form-select>
            </div>

            <div ref="transcript" class="td-assistant-transcript">
                <div v-if="!messages.length && !streamingText" class="td-assistant-empty">
                    {{ $t('assistant.empty') }}
                </div>

                <td-assistant-message
                    v-for="(message, idx) in messages"
                    :key="idx"
                    :message="message"
                />

                <div v-if="streamingText" class="td-assistant-streaming">
                    <div class="td-assistant-role">{{ $t('assistant.roles.assistant') }}</div>
                    <div class="td-assistant-text">{{ streamingText }}</div>
                </div>

                <div v-if="pendingToolCalls.length" class="td-assistant-activity">
                    <div
                        v-for="call in pendingToolCalls"
                        :key="call.id"
                        class="td-assistant-activity-row"
                    >
                        <b-spinner v-if="call.status === 'running'" small class="mr-1" />
                        <font-awesome-icon
                            v-else
                            :icon="call.status === 'ok' ? 'check' : 'exclamation-triangle'"
                            :class="call.status === 'ok' ? 'text-success' : 'text-danger'"
                            class="mr-1"
                        />
                        <span>{{ call.name }}</span>
                        <span v-if="call.error" class="td-assistant-activity-error">— {{ call.error }}</span>
                    </div>
                </div>
            </div>

            <div v-if="error" class="td-assistant-error">
                {{ error }}
            </div>
            <div v-if="!hasDiagram" class="td-assistant-hint">
                {{ $t('assistant.noDiagram') }}
            </div>

            <td-assistant-composer
                :busy="busy"
                :can-send="canSend"
                @send="send"
                @stop="stop"
            />
        </div>
    </b-card>
</template>

<script>
import { mapState } from 'vuex';
import isElectron from 'is-electron';

import TdAssistantComposer from '@/components/Assistant/AssistantComposer.vue';
import TdAssistantMessage from '@/components/Assistant/AssistantMessage.vue';
import { createBinding } from '@/service/assistant/browserBinding.js';
import { PROVIDER_CATALOG } from '@/service/assistant/providerCatalog.js';
import assistantActions from '@/store/actions/assistant.js';

export default {
    name: 'TdAssistantPanel',
    components: {
        TdAssistantComposer,
        TdAssistantMessage
    },
    props: {
        graph: {
            required: true
        }
    },
    data() {
        return {
            controller: null,
            selectedProvider: null,
            selectedModel: null,
            isDesktop: isElectron(),
            desktopProviders: [],
            desktopDefaults: { provider: null, model: null }
        };
    },
    computed: {
        ...mapState({
            messages: (state) => state.assistant.messages,
            streamingText: (state) => state.assistant.streamingText,
            pendingToolCalls: (state) => state.assistant.pendingToolCalls,
            runState: (state) => state.assistant.runState,
            error: (state) => state.assistant.error,
            selectedDiagram: (state) => state.threatmodel.selectedDiagram
        }),
        busy() {
            return this.runState === 'running';
        },
        aiConfig() {
            // Desktop has no backend /api/config: the provider list comes from the
            // catalogue filtered to providers with a stored key.
            if (this.isDesktop) {
                return {
                    enabled: true,
                    providers: this.desktopProviders,
                    defaultProvider: this.desktopDefaults.provider,
                    defaultModel: this.desktopDefaults.model
                };
            }
            const cfg = (this.$store.state.config && this.$store.state.config.config) || {};
            return {
                enabled: !!cfg.llmEnabled,
                providers: cfg.llmProviders || [],
                defaultProvider: cfg.llmDefaultProvider || null,
                defaultModel: cfg.llmDefaultModel || null
            };
        },
        providerOptions() {
            return this.aiConfig.providers.map((p) => ({ value: p.id, text: p.label || p.id }));
        },
        modelOptions() {
            const provider = this.aiConfig.providers.find((p) => p.id === this.selectedProvider);
            const models = (provider && provider.models) || [];
            return models.map((m) => (typeof m === 'string'
                ? { value: m, text: m }
                : { value: m.id, text: m.label || m.id }));
        },
        hasDiagram() {
            return !!(this.selectedDiagram && this.selectedDiagram.diagramType);
        },
        canSend() {
            return this.aiConfig.enabled && this.hasDiagram && !!this.selectedProvider && !!this.selectedModel;
        }
    },
    watch: {
        messages() {
            this.scrollToBottom();
        },
        streamingText() {
            this.scrollToBottom();
        },
        panelOpen(open) {
            // re-read desktop keys/settings when the panel is opened (a key may have
            // just been added via the settings modal)
            if (open && this.isDesktop) {
                this.loadDesktopConfig().then(() => this.initSelection());
            }
        }
    },
    async mounted() {
        if (this.isDesktop) {
            await this.loadDesktopConfig();
        }
        this.initSelection();
    },
    methods: {
        async loadDesktopConfig() {
            if (!window.electronAPI || !window.electronAPI.llmGetProviders) {
                return;
            }
            try {
                const configured = await window.electronAPI.llmGetProviders();
                this.desktopProviders = PROVIDER_CATALOG.filter((p) => configured.includes(p.id));
                const settings = await window.electronAPI.llmGetSettings();
                this.desktopDefaults = { provider: settings.provider || null, model: settings.model || null };
            } catch (e) {
                console.warn('Failed to load desktop LLM settings', e);
            }
        },
        initSelection() {
            const providers = this.aiConfig.providers;
            if (!providers.length) {
                return;
            }
            const flagged = providers.find((p) => p.default);
            this.selectedProvider = this.$store.state.assistant.provider
                || this.aiConfig.defaultProvider
                || (flagged && flagged.id)
                || providers[0].id;
            this.$store.dispatch(assistantActions.setProvider, this.selectedProvider);
            this.applyDefaultModel();
        },
        applyDefaultModel() {
            const provider = this.aiConfig.providers.find((p) => p.id === this.selectedProvider);
            const models = (provider && provider.models) || [];
            const first = models.length
                ? (typeof models[0] === 'string' ? models[0] : models[0].id)
                : null;
            this.selectedModel = this.$store.state.assistant.model || this.aiConfig.defaultModel || first;
            this.$store.dispatch(assistantActions.setModel, this.selectedModel);
        },
        onProviderChange(value) {
            this.selectedProvider = value;
            this.$store.dispatch(assistantActions.setProvider, value);
            this.selectedModel = null;
            this.$store.dispatch(assistantActions.setModel, null);
            this.applyDefaultModel();
            this.persistDesktopSelection();
        },
        onModelChange(value) {
            this.selectedModel = value;
            this.$store.dispatch(assistantActions.setModel, value);
            this.persistDesktopSelection();
        },
        persistDesktopSelection() {
            if (this.isDesktop && window.electronAPI && window.electronAPI.llmSetSettings) {
                window.electronAPI.llmSetSettings({ provider: this.selectedProvider, model: this.selectedModel });
            }
        },
        send(text) {
            this.controller = new AbortController();
            const binding = createBinding(this.graph, this.$store);
            this.$store.dispatch(assistantActions.send, {
                text,
                binding,
                signal: this.controller.signal
            });
        },
        stop() {
            if (this.controller) {
                this.controller.abort();
            }
        },
        clear() {
            this.$store.dispatch(assistantActions.clear);
        },
        scrollToBottom() {
            this.$nextTick(() => {
                const el = this.$refs.transcript;
                if (el) {
                    el.scrollTop = el.scrollHeight;
                }
            });
        }
    }
};
</script>

<style lang="scss" scoped>
.td-assistant-panel {
    height: 72vh;
    display: flex;
    flex-direction: column;
}
.td-assistant-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.td-assistant-title {
    font-weight: bold;
}
.td-assistant-header-actions {
    display: flex;
    gap: 4px;
}
.td-assistant-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 10px;
}
.td-assistant-selectors {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
}
.td-assistant-transcript {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding-right: 4px;
}
.td-assistant-empty,
.td-assistant-hint,
.td-assistant-disabled {
    color: #888;
    font-size: 13px;
    padding: 8px 0;
}
.td-assistant-streaming {
    background-color: #f6f6f6;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
}
.td-assistant-role {
    font-weight: bold;
    font-size: 11px;
    text-transform: uppercase;
    opacity: 0.6;
    margin-bottom: 3px;
}
.td-assistant-activity {
    margin-top: 6px;
    font-size: 12px;
}
.td-assistant-activity-error {
    color: #b00;
    margin-left: 4px;
}
.td-assistant-error {
    color: #b00;
    font-size: 12px;
    margin: 6px 0;
}
</style>
