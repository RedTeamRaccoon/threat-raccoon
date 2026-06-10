import { BootstrapVue } from 'bootstrap-vue';
import { shallowMount, createLocalVue } from '@vue/test-utils';

import TdAssistantPanel from '@/components/Assistant/AssistantPanel.vue';

// Regression cover for the provider-switch model-default bug: switching the
// provider must select a model the NEW provider actually offers, never the
// global default model (which the server would reject for that provider).
describe('components/Assistant/AssistantPanel.vue', () => {
    const config = {
        llmEnabled: true,
        llmProviders: [
            { id: 'anthropic', label: 'Anthropic', models: [{ id: 'claude-opus-4-8' }], default: 'claude-opus-4-8' },
            { id: 'openai', label: 'OpenAI', models: [{ id: 'gpt-4o' }], default: 'gpt-4o' }
        ],
        llmDefaultProvider: 'anthropic',
        llmDefaultModel: 'claude-opus-4-8'
    };

    const mountPanel = () => {
        const state = {
            config: { config },
            assistant: { provider: null, model: null, messages: [], streamingText: '', pendingToolCalls: [], runState: 'idle', error: null },
            threatmodel: { selectedDiagram: { id: 0, diagramType: 'STRIDE' } }
        };
        const store = { state, dispatch: jest.fn() };
        const localVue = createLocalVue();
        localVue.use(BootstrapVue);
        const wrapper = shallowMount(TdAssistantPanel, {
            localVue,
            propsData: { graph: {} },
            mocks: { $t: (t) => t, $store: store }
        });
        return { wrapper, store };
    };

    it('defaults to the configured provider and its model on mount', () => {
        const { wrapper } = mountPanel();
        expect(wrapper.vm.selectedProvider).toBe('anthropic');
        expect(wrapper.vm.selectedModel).toBe('claude-opus-4-8');
    });

    it('picks a model the new provider offers when switching providers', () => {
        const { wrapper, store } = mountPanel();
        wrapper.vm.onProviderChange('openai');
        // must be openai's own model, NOT the global default claude-opus-4-8
        expect(wrapper.vm.selectedModel).toBe('gpt-4o');
        expect(store.dispatch).toHaveBeenCalledWith('ASSISTANT_SET_MODEL', 'gpt-4o');
    });
});
