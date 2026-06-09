<template>
    <b-modal id="assistant-settings-modal" :title="$t('assistant.settings')" hide-footer>
        <p class="td-settings-intro">{{ $t('assistant.settingsModal.intro') }}</p>

        <b-form-group :label="$t('assistant.settingsModal.provider')" label-for="settings-provider">
            <b-form-select
                id="settings-provider"
                v-model="selectedProvider"
                :options="providerOptions"
            ></b-form-select>
        </b-form-group>

        <b-form-group :label="$t('assistant.settingsModal.apiKey')" label-for="settings-key">
            <b-form-input
                id="settings-key"
                v-model="keyInput"
                type="password"
                autocomplete="off"
                :placeholder="$t('assistant.settingsModal.apiKeyPlaceholder')"
            ></b-form-input>
        </b-form-group>

        <div class="d-flex justify-content-end mb-3">
            <b-button
                size="sm"
                variant="primary"
                :disabled="!selectedProvider || !keyInput"
                @click="save"
            >
                {{ $t('assistant.settingsModal.save') }}
            </b-button>
        </div>

        <hr />

        <ul class="list-unstyled td-settings-list">
            <li
                v-for="provider in catalog"
                :key="provider.id"
                class="d-flex justify-content-between align-items-center mb-1"
            >
                <span>
                    {{ provider.label }}
                    <b-badge :variant="isConfigured(provider.id) ? 'success' : 'secondary'" class="ml-1">
                        {{ isConfigured(provider.id)
                            ? $t('assistant.settingsModal.configured')
                            : $t('assistant.settingsModal.notConfigured') }}
                    </b-badge>
                </span>
                <b-button
                    v-if="isConfigured(provider.id)"
                    size="sm"
                    variant="outline-danger"
                    @click="clearKey(provider.id)"
                >
                    {{ $t('assistant.settingsModal.clear') }}
                </b-button>
            </li>
        </ul>
    </b-modal>
</template>

<script>
import { PROVIDER_CATALOG } from '@/service/assistant/providerCatalog.js';

export default {
    name: 'TdAssistantSettings',
    data() {
        return {
            catalog: PROVIDER_CATALOG,
            selectedProvider: null,
            keyInput: '',
            configuredIds: []
        };
    },
    computed: {
        providerOptions() {
            return this.catalog.map((p) => ({ value: p.id, text: p.label }));
        }
    },
    mounted() {
        if (window.electronAPI && window.electronAPI.onOpenLlmSettings) {
            window.electronAPI.onOpenLlmSettings(() => this.open());
        }
    },
    methods: {
        isConfigured(id) {
            return this.configuredIds.includes(id);
        },
        async refresh() {
            if (!window.electronAPI || !window.electronAPI.llmGetProviders) {
                return;
            }
            this.configuredIds = (await window.electronAPI.llmGetProviders()) || [];
        },
        async open() {
            await this.refresh();
            if (!this.selectedProvider && this.catalog.length) {
                this.selectedProvider = this.catalog[0].id;
            }
            this.$bvModal.show('assistant-settings-modal');
        },
        async save() {
            if (!this.selectedProvider || !this.keyInput) {
                return;
            }
            await window.electronAPI.llmSetKey(this.selectedProvider, this.keyInput);
            this.keyInput = '';
            await this.refresh();
        },
        async clearKey(id) {
            await window.electronAPI.llmSetKey(id, '');
            await this.refresh();
        }
    }
};
</script>

<style lang="scss" scoped>
.td-settings-intro {
    font-size: 13px;
    color: #555;
}
.td-settings-list {
    font-size: 13px;
}
</style>
