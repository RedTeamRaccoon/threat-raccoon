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
                        :variant="settingsOpen ? 'secondary' : 'outline-secondary'"
                        :title="$t('assistant.runSettings.maxStepsHint')"
                        :pressed="settingsOpen"
                        @click="settingsOpen = !settingsOpen"
                    >
                        <font-awesome-icon icon="cog" />
                    </b-button>
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

            <div v-if="settingsOpen" class="td-assistant-settings-row">
                <label class="td-assistant-settings-label" for="td-assistant-max-steps">
                    {{ $t('assistant.runSettings.maxSteps') }}
                </label>
                <b-form-input
                    id="td-assistant-max-steps"
                    v-model.number="maxSteps"
                    type="number"
                    size="sm"
                    min="10"
                    max="200"
                    step="5"
                    :disabled="busy"
                    :title="$t('assistant.runSettings.maxStepsHint')"
                    class="td-assistant-settings-input"
                    @change="onMaxStepsChange"
                ></b-form-input>
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

                <!-- the gap between Send and the first streamed token (or between
                     agent turns) otherwise shows NOTHING moving -->
                <div v-if="busy && !streamingText" class="td-assistant-working">
                    <b-spinner small class="mr-1" />{{ $t('assistant.working') }}
                </div>

                <!-- long documents are ingested section by section; show which
                     section the agent is currently incorporating -->
                <div v-if="sectionProgress" class="td-assistant-sections">
                    {{ $t('assistant.sections', sectionProgress) }}
                </div>

                <!-- the agent loop hit the step cap and stopped (per-request
                     billing) rather than auto-continuing forever; tell the user
                     to send 'continue' to resume -->
                <div v-if="stepLimitReached" class="td-assistant-limit">
                    <font-awesome-icon icon="exclamation-triangle" class="mr-1" />
                    {{ $t('assistant.stepLimit', { count: stepLimitReached }) }}
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
            <div v-if="showVisionWarning" class="td-assistant-vision-warning">
                {{ $t('assistant.visionWarning') }}
            </div>
            <div v-if="mode === 'diagram' && !hasDiagram" class="td-assistant-hint">
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

import api from '@/service/api/api.js';
import TdAssistantComposer from '@/components/Assistant/AssistantComposer.vue';
import TdAssistantMessage from '@/components/Assistant/AssistantMessage.vue';
import { createBinding } from '@/service/assistant/browserBinding.js';
import { createModelBinding } from '@/service/assistant/modelBinding.js';
import { MODEL_MODE_CONTEXT } from '@/service/assistant/agentLoop.js';
import { PROVIDER_CATALOG } from '@/service/assistant/providerCatalog.js';
import assistantActions from '@/store/actions/assistant.js';

export default {
    name: 'TdAssistantPanel',
    components: {
        TdAssistantComposer,
        TdAssistantMessage
    },
    props: {
        // the live X6 graph; only required in diagram mode
        graph: {
            required: false,
            default: null
        },
        // 'diagram' drives the live canvas of the open diagram (browserBinding);
        // 'model' runs the pure tmcore ops against the whole stored model
        // (modelBinding) — used on the threat model overview page
        mode: {
            type: String,
            default: 'diagram'
        }
    },
    data() {
        return {
            controller: null,
            selectedProvider: null,
            selectedModel: null,
            settingsOpen: false,
            // local mirror of the persisted store setting, so the number input is
            // freely editable while typing; clamped + committed on @change
            maxSteps: this.$store.state.assistant.maxSteps,
            isDesktop: isElectron(),
            desktopProviders: [],
            desktopDefaults: { provider: null, model: null },
            // provider id -> model ids fetched LIVE from the provider's account
            // (server mode), so the selector lists what is actually available
            // instead of only the env-configured default
            liveModels: {}
        };
    },
    computed: {
        ...mapState({
            messages: (state) => state.assistant.messages,
            streamingText: (state) => state.assistant.streamingText,
            pendingToolCalls: (state) => state.assistant.pendingToolCalls,
            runState: (state) => state.assistant.runState,
            error: (state) => state.assistant.error,
            sectionProgress: (state) => state.assistant.sectionProgress,
            stepLimitReached: (state) => state.assistant.stepLimitReached,
            attachments: (state) => state.assistant.attachments,
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
            const models = this.availableModels(this.selectedProvider);
            const ids = models.map((m) => m.id);
            // While the live list for this provider is still pending, the env list
            // is only provisional — surface the stored/selected pick too so the
            // select can display it (the option must exist for v-model to show it).
            let list = models;
            if (this.selectedModel && !ids.includes(this.selectedModel)
                && !this.hasLiveModels(this.selectedProvider)) {
                list = [{ id: this.selectedModel, vision: null }, ...models];
            }
            return list.map((m) => ({ value: m.id, text: this.modelOptionText(m) }));
        },
        showVisionWarning() {
            // Warn only when the user has staged image attachments AND the
            // selected model is KNOWN not to support vision. Unknown vision
            // (null — env fallbacks, OpenAI) never warns.
            const model = this.availableModels(this.selectedProvider)
                .find((m) => m.id === this.selectedModel);
            if (!model || model.vision !== false) {
                return false;
            }
            const attachments = this.attachments || [];
            return attachments.some((a) => a.kind === 'image');
        },
        hasDiagram() {
            return !!(this.selectedDiagram && this.selectedDiagram.diagramType);
        },
        hasModel() {
            const data = this.$store.state.threatmodel && this.$store.state.threatmodel.data;
            return !!(data && data.summary);
        },
        canSend() {
            // model mode needs a loaded model; diagram mode needs an open diagram
            const target = this.mode === 'model' ? this.hasModel : this.hasDiagram;
            return this.aiConfig.enabled && target && !!this.selectedProvider && !!this.selectedModel;
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
        this.fetchLiveModels(this.selectedProvider);
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
        hasLiveModels(providerId) {
            const live = this.liveModels[providerId];
            return !!(live && live.length);
        },
        // Normalizes a model entry from either accepted shape — a bare id string
        // (legacy / env-configured fallback) or an { id, vision } object — into
        // a uniform { id, vision } where vision is true|false|null (null =
        // unknown). String entries are unknown-vision.
        normalizeModel(m) {
            if (typeof m === 'string') {
                return { id: m, vision: null };
            }
            return { id: m.id, vision: (typeof m.vision === 'boolean' ? m.vision : null) };
        },
        availableModels(providerId) {
            // live (account-accurate) list when fetched; env-configured fallback
            const live = this.liveModels[providerId];
            if (live && live.length) {
                return live.map((m) => this.normalizeModel(m));
            }
            const provider = this.aiConfig.providers.find((p) => p.id === providerId);
            const models = (provider && provider.models) || [];
            return models.map((m) => this.normalizeModel(m));
        },
        availableModelIds(providerId) {
            return this.availableModels(providerId).map((m) => m.id);
        },
        modelOptionText(model) {
            // Mark KNOWN no-vision models so the user understands attaching an
            // image/PDF will not be seen. Unknown vision (null) shows plain id.
            if (model.vision === false) {
                return `${model.id} — ${this.$t('assistant.noVision')}`;
            }
            return model.id;
        },
        applyDefaultModel() {
            const provider = this.aiConfig.providers.find((p) => p.id === this.selectedProvider);
            const ids = this.availableModelIds(this.selectedProvider);
            const stored = this.$store.state.assistant.model;
            // Persisted/stored pick + env-only list still pending the live fetch:
            // the env list is NOT authoritative about what the account offers, so
            // do NOT clobber the user's stored model. Keep it (modelOptions surfaces
            // it) until fetchLiveModels arrives and re-validates against the real
            // list — on live-fetch success applyDefaultModel runs again; on failure
            // the env list stays non-authoritative and the pick is kept.
            if (stored && !this.hasLiveModels(this.selectedProvider)) {
                this.selectedModel = stored;
                this.$store.dispatch(assistantActions.setModel, stored);
                return;
            }
            // Pick the first candidate that the SELECTED provider actually offers,
            // so switching providers never leaves a model from another provider
            // (e.g. the global default) selected — which the server would reject.
            // With a live list this also walks past a retired configured default.
            const providerDefault = provider && provider.default;
            const candidates = [stored, providerDefault, this.aiConfig.defaultModel];
            const picked = candidates.find((m) => m && ids.includes(m)) || ids[0] || null;
            this.selectedModel = picked;
            this.$store.dispatch(assistantActions.setModel, picked);
        },
        async fetchLiveModels(providerId) {
            // desktop has no backend; refetch per provider once per panel life
            if (this.isDesktop || !providerId || this.liveModels[providerId]) {
                return;
            }
            try {
                const resp = await api.getAsync(`/api/llm/models/${providerId}`);
                const models = (resp.data && resp.data.models) || [];
                if (models.length) {
                    this.liveModels = { ...this.liveModels, [providerId]: models };
                    // re-validate the selection against the real list (keeps the
                    // user's pick when still offered, replaces it when retired)
                    if (providerId === this.selectedProvider) {
                        this.applyDefaultModel();
                    }
                }
            } catch (e) {
                console.warn(`Live model list unavailable for ${providerId}, using configured default`, e);
            }
        },
        onProviderChange(value) {
            this.selectedProvider = value;
            this.$store.dispatch(assistantActions.setProvider, value);
            this.selectedModel = null;
            this.$store.dispatch(assistantActions.setModel, null);
            this.applyDefaultModel();
            this.fetchLiveModels(value);
            this.persistDesktopSelection();
        },
        onModelChange(value) {
            this.selectedModel = value;
            this.$store.dispatch(assistantActions.setModel, value);
            this.persistDesktopSelection();
        },
        onMaxStepsChange() {
            // dispatch clamps to the sane range (10-200); mirror the clamped
            // result back into the input so an out-of-range entry self-corrects
            this.$store.dispatch(assistantActions.setMaxSteps, this.maxSteps);
            this.maxSteps = this.$store.state.assistant.maxSteps;
        },
        persistDesktopSelection() {
            if (this.isDesktop && window.electronAPI && window.electronAPI.llmSetSettings) {
                window.electronAPI.llmSetSettings({ provider: this.selectedProvider, model: this.selectedModel });
            }
        },
        send(text) {
            this.controller = new AbortController();
            const modelMode = this.mode === 'model';
            const binding = modelMode
                ? createModelBinding(this.$store)
                : createBinding(this.graph, this.$store);
            this.$store.dispatch(assistantActions.send, {
                text,
                binding,
                signal: this.controller.signal,
                systemContext: modelMode ? MODEL_MODE_CONTEXT : undefined,
                maxSteps: this.$store.state.assistant.maxSteps
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
.td-assistant-settings-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 6px 8px;
    background-color: #f6f6f6;
    border-radius: 6px;
    font-size: 13px;
}
.td-assistant-settings-label {
    margin: 0;
    flex: 1;
    color: #555;
}
.td-assistant-settings-input {
    width: 80px;
    flex: 0 0 auto;
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
.td-assistant-working,
.td-assistant-sections {
    color: #888;
    font-size: 12px;
    margin-top: 6px;
}
.td-assistant-limit {
    color: #8a6d00;
    background-color: #fff8e1;
    border: 1px solid #ffe39e;
    border-radius: 6px;
    font-size: 12px;
    padding: 6px 8px;
    margin-top: 8px;
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
.td-assistant-vision-warning {
    color: #8a6d00;
    font-size: 12px;
    margin: 6px 0;
}
</style>
