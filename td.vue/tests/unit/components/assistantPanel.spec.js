import { BootstrapVue } from 'bootstrap-vue';
import { shallowMount, createLocalVue } from '@vue/test-utils';

import api from '@/service/api/api.js';
import TdAssistantPanel from '@/components/Assistant/AssistantPanel.vue';
import { createModelBinding } from '@/service/assistant/modelBinding.js';
import { MODEL_MODE_CONTEXT } from '@/service/assistant/agentLoop.js';

jest.mock('@/service/api/api.js', () => ({ getAsync: jest.fn() }));
jest.mock('@/service/assistant/modelBinding.js', () => ({ createModelBinding: jest.fn() }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

    const mountPanel = ({ propsData, threatmodel, assistant } = {}) => {
        const state = {
            config: { config },
            assistant: {
                provider: null, model: null, messages: [], streamingText: '',
                pendingToolCalls: [], runState: 'idle', error: null,
                ...(assistant || {})
            },
            threatmodel: threatmodel || { selectedDiagram: { id: 0, diagramType: 'STRIDE' } }
        };
        const store = { state, dispatch: jest.fn() };
        const localVue = createLocalVue();
        localVue.use(BootstrapVue);
        const wrapper = shallowMount(TdAssistantPanel, {
            localVue,
            propsData: propsData || { graph: {} },
            mocks: { $t: (t) => t, $store: store }
        });
        return { wrapper, store };
    };

    beforeEach(() => {
        // default: live model listing unavailable -> env-configured fallback
        api.getAsync.mockRejectedValue(new Error('unavailable'));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

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

    describe('working indicator', () => {
        it('shows a spinner while a run is active but nothing is streaming yet', () => {
            const { wrapper } = mountPanel({ assistant: { runState: 'running' } });
            expect(wrapper.find('.td-assistant-working').exists()).toBe(true);
        });

        it('hides the spinner once text is streaming', () => {
            const { wrapper } = mountPanel({ assistant: { runState: 'running', streamingText: 'building…' } });
            expect(wrapper.find('.td-assistant-working').exists()).toBe(false);
        });

        it('shows nothing when idle', () => {
            const { wrapper } = mountPanel();
            expect(wrapper.find('.td-assistant-working').exists()).toBe(false);
        });
    });

    describe('model mode (threat model overview page)', () => {
        const fakeBinding = { execute: jest.fn() };

        beforeEach(() => {
            // resetMocks wipes implementations between tests
            createModelBinding.mockReturnValue(fakeBinding);
        });

        it('can send when a model is loaded, even without an open diagram', () => {
            const { wrapper } = mountPanel({
                propsData: { mode: 'model' },
                threatmodel: { data: { summary: { title: 't' } }, selectedDiagram: {} }
            });
            expect(wrapper.vm.canSend).toBe(true);
        });

        it('cannot send when no model is loaded', () => {
            const { wrapper } = mountPanel({
                propsData: { mode: 'model' },
                threatmodel: { data: {}, selectedDiagram: {} }
            });
            expect(wrapper.vm.canSend).toBe(false);
        });

        it('hides the open-a-diagram hint in model mode', () => {
            const { wrapper } = mountPanel({
                propsData: { mode: 'model' },
                threatmodel: { data: {}, selectedDiagram: {} }
            });
            expect(wrapper.find('.td-assistant-hint').exists()).toBe(false);
        });

        it('sends with the model binding and the model-mode system context', () => {
            const { wrapper, store } = mountPanel({
                propsData: { mode: 'model' },
                threatmodel: { data: { summary: { title: 't' } }, selectedDiagram: {} }
            });
            wrapper.vm.send('add a diagram');
            expect(createModelBinding).toHaveBeenCalledWith(store);
            expect(store.dispatch).toHaveBeenCalledWith('ASSISTANT_SEND', expect.objectContaining({
                text: 'add a diagram',
                binding: fakeBinding,
                systemContext: MODEL_MODE_CONTEXT
            }));
        });

        it('still uses the live-canvas binding (no model context) in diagram mode', () => {
            const { wrapper, store } = mountPanel();
            wrapper.vm.send('add a process');
            expect(createModelBinding).not.toHaveBeenCalled();
            const payload = store.dispatch.mock.calls.find(([action]) => action === 'ASSISTANT_SEND')[1];
            expect(payload.systemContext).toBeUndefined();
            expect(payload.binding).not.toBe(fakeBinding);
        });
    });

    describe('live model lists', () => {
        it('offers the models the provider account actually has', async () => {
            api.getAsync.mockResolvedValue({ data: { models: ['claude-opus-4-8', 'claude-sonnet-4-6'] } });
            const { wrapper } = mountPanel();
            await flush();

            expect(api.getAsync).toHaveBeenCalledWith('/api/llm/models/anthropic');
            expect(wrapper.vm.modelOptions.map((o) => o.value)).
                toEqual(['claude-opus-4-8', 'claude-sonnet-4-6']);
            // the configured default is still offered, so it stays selected
            expect(wrapper.vm.selectedModel).toBe('claude-opus-4-8');
        });

        it('falls back to an available model when the configured default was retired', async () => {
            api.getAsync.mockResolvedValue({ data: { models: ['claude-fable-5', 'claude-haiku-4-5'] } });
            const { wrapper } = mountPanel();
            await flush();

            // claude-opus-4-8 (env default) is gone upstream: pick what exists
            expect(wrapper.vm.selectedModel).toBe('claude-fable-5');
        });

        it('keeps the env-configured model list when the live fetch fails', async () => {
            const { wrapper } = mountPanel();
            await flush();

            expect(wrapper.vm.modelOptions.map((o) => o.value)).toEqual(['claude-opus-4-8']);
            expect(wrapper.vm.selectedModel).toBe('claude-opus-4-8');
        });

        it('fetches the new provider list on switch', async () => {
            api.getAsync.mockResolvedValue({ data: { models: [] } });
            const { wrapper } = mountPanel();
            await flush();

            wrapper.vm.onProviderChange('openai');
            expect(api.getAsync).toHaveBeenCalledWith('/api/llm/models/openai');
        });
    });
});
