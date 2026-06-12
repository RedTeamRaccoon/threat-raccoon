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
                pendingToolCalls: [], runState: 'idle', error: null, sectionProgress: null,
                maxSteps: 50, stepLimitReached: null,
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
            mocks: {
                // param-aware so assertions can see interpolation values
                $t: (key, params) => (params ? `${key}${JSON.stringify(params)}` : key),
                $store: store
            }
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

    describe('section progress', () => {
        it('shows which document section is being incorporated', () => {
            const { wrapper } = mountPanel({
                assistant: {
                    runState: 'running',
                    sectionProgress: { current: 2, total: 5, name: 'spec.pdf' }
                }
            });
            const row = wrapper.find('.td-assistant-sections');
            expect(row.exists()).toBe(true);
            expect(row.text()).toContain('assistant.sections');
            expect(row.text()).toContain('"current":2');
            expect(row.text()).toContain('"total":5');
            expect(row.text()).toContain('spec.pdf');
        });

        it('shows no section row when no chunked document is being ingested', () => {
            const { wrapper } = mountPanel({ assistant: { runState: 'running' } });
            expect(wrapper.find('.td-assistant-sections').exists()).toBe(false);
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

        it('includes maxSteps in the ASSISTANT_SEND payload (model mode)', () => {
            const { wrapper, store } = mountPanel({
                propsData: { mode: 'model' },
                threatmodel: { data: { summary: { title: 't' } }, selectedDiagram: {} },
                assistant: { maxSteps: 80 }
            });
            wrapper.vm.send('build it');
            const payload = store.dispatch.mock.calls.find(([action]) => action === 'ASSISTANT_SEND')[1];
            expect(payload.maxSteps).toBe(80);
        });

        it('includes maxSteps in the ASSISTANT_SEND payload (diagram mode)', () => {
            const { wrapper, store } = mountPanel({ assistant: { maxSteps: 65 } });
            wrapper.vm.send('add a process');
            const payload = store.dispatch.mock.calls.find(([action]) => action === 'ASSISTANT_SEND')[1];
            expect(payload.maxSteps).toBe(65);
        });
    });

    describe('settings (gear) + maxSteps', () => {
        it('hides the settings row until the gear is toggled', () => {
            const { wrapper } = mountPanel();
            expect(wrapper.find('.td-assistant-settings-row').exists()).toBe(false);
            wrapper.vm.settingsOpen = true;
            expect(wrapper.vm.settingsOpen).toBe(true);
        });

        it('initialises the local maxSteps mirror from the store', () => {
            const { wrapper } = mountPanel({ assistant: { maxSteps: 120 } });
            expect(wrapper.vm.maxSteps).toBe(120);
        });

        it('dispatches the clamped maxSteps on change and mirrors the clamped value back', () => {
            const { wrapper, store } = mountPanel();
            // simulate the store clamping the dispatched value
            store.dispatch.mockImplementation((action, value) => {
                if (action === 'ASSISTANT_SET_MAX_STEPS') {
                    store.state.assistant.maxSteps = Math.min(200, Math.max(10, value));
                }
            });
            wrapper.vm.maxSteps = 9999;
            wrapper.vm.onMaxStepsChange();
            expect(store.dispatch).toHaveBeenCalledWith('ASSISTANT_SET_MAX_STEPS', 9999);
            // the input self-corrects to the clamped stored value
            expect(wrapper.vm.maxSteps).toBe(200);
        });
    });

    describe('step-limit notice', () => {
        it('shows the limit row with the interpolated count when the cap was hit', () => {
            const { wrapper } = mountPanel({ assistant: { stepLimitReached: 50 } });
            const row = wrapper.find('.td-assistant-limit');
            expect(row.exists()).toBe(true);
            expect(row.text()).toContain('assistant.stepLimit');
            expect(row.text()).toContain('"count":50');
        });

        it('shows no limit row when the cap was not hit', () => {
            const { wrapper } = mountPanel();
            expect(wrapper.find('.td-assistant-limit').exists()).toBe(false);
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

    // The chat (provider/model/messages) is persisted to sessionStorage and
    // restored on the next page load. A restored model pick may not be in the
    // env-configured fallback list (the env list is not authoritative about what
    // the account offers) — mounting must NOT clobber it before the live list
    // arrives.
    describe('restored model selection (persistence clobber regression)', () => {
        it('keeps a stored model not in the env list while the live list is pending', () => {
            // live fetch stays unresolved (rejected default) -> only env list known
            const { wrapper } = mountPanel({
                assistant: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
            });
            // env list for anthropic is only [claude-opus-4-8] but the stored pick
            // must survive mount and be offered by the select
            expect(wrapper.vm.selectedModel).toBe('claude-sonnet-4-6');
            expect(wrapper.vm.modelOptions.map((o) => o.value)).toContain('claude-sonnet-4-6');
        });

        it('does not dispatch a different model over the stored pick on mount', () => {
            const { store } = mountPanel({
                assistant: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
            });
            const setModelCalls = store.dispatch.mock.calls
                .filter(([action]) => action === 'ASSISTANT_SET_MODEL')
                .map(([, value]) => value);
            // it may re-affirm the stored pick, but must never set anything else
            expect(setModelCalls.every((m) => m === 'claude-sonnet-4-6')).toBe(true);
        });

        it('replaces the stored pick once the live list arrives WITHOUT it', async () => {
            api.getAsync.mockResolvedValue({ data: { models: ['claude-opus-4-8', 'claude-haiku-4-5'] } });
            const { wrapper } = mountPanel({
                assistant: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
            });
            await flush();

            // claude-sonnet-4-6 is not offered by the account -> fall to a real one
            expect(wrapper.vm.selectedModel).toBe('claude-opus-4-8');
            expect(wrapper.vm.modelOptions.map((o) => o.value))
                .toEqual(['claude-opus-4-8', 'claude-haiku-4-5']);
        });

        it('keeps the stored pick once the live list arrives WITH it', async () => {
            api.getAsync.mockResolvedValue({ data: { models: ['claude-opus-4-8', 'claude-sonnet-4-6'] } });
            const { wrapper } = mountPanel({
                assistant: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
            });
            await flush();

            expect(wrapper.vm.selectedModel).toBe('claude-sonnet-4-6');
        });

        it('keeps the stored pick when the live fetch fails (env list not authoritative)', async () => {
            // default beforeEach rejects the live fetch
            const { wrapper } = mountPanel({
                assistant: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
            });
            await flush();

            expect(wrapper.vm.selectedModel).toBe('claude-sonnet-4-6');
        });
    });

    describe('vision-aware model lists', () => {
        it('normalizes an { id, vision } object live list', async () => {
            api.getAsync.mockResolvedValue({ data: { models: [
                { id: 'claude-opus-4-8', vision: true },
                { id: 'claude-haiku-4-5', vision: false }
            ] } });
            const { wrapper } = mountPanel();
            await flush();

            expect(wrapper.vm.modelOptions.map((o) => o.value))
                .toEqual(['claude-opus-4-8', 'claude-haiku-4-5']);
        });

        it('appends the noVision marker to vision-false option text only', async () => {
            api.getAsync.mockResolvedValue({ data: { models: [
                { id: 'gpt-4o', vision: true },
                { id: 'gpt-3.5-turbo', vision: false }
            ] } });
            const { wrapper } = mountPanel({ assistant: { provider: 'openai' } });
            await flush();

            const byId = Object.fromEntries(wrapper.vm.modelOptions.map((o) => [o.value, o.text]));
            expect(byId['gpt-4o']).toBe('gpt-4o');
            expect(byId['gpt-3.5-turbo']).toBe('gpt-3.5-turbo — assistant.noVision');
        });

        it('shows no marker for string (env fallback) lists -> unknown vision', () => {
            // live fetch rejected by default beforeEach -> env list of plain strings
            const { wrapper } = mountPanel();
            expect(wrapper.vm.modelOptions.every((o) => !o.text.includes('assistant.noVision'))).toBe(true);
        });

        it('warns when image attachments are staged AND the selected model has vision === false', async () => {
            api.getAsync.mockResolvedValue({ data: { models: [{ id: 'gpt-3.5-turbo', vision: false }] } });
            const { wrapper } = mountPanel({
                assistant: { provider: 'openai', attachments: [{ kind: 'image' }] }
            });
            await flush();

            expect(wrapper.vm.selectedModel).toBe('gpt-3.5-turbo');
            expect(wrapper.vm.showVisionWarning).toBe(true);
            expect(wrapper.find('.td-assistant-vision-warning').exists()).toBe(true);
        });

        it('does not warn for a vision-capable selected model', async () => {
            api.getAsync.mockResolvedValue({ data: { models: [{ id: 'gpt-4o', vision: true }] } });
            const { wrapper } = mountPanel({
                assistant: { provider: 'openai', attachments: [{ kind: 'image' }] }
            });
            await flush();

            expect(wrapper.vm.showVisionWarning).toBe(false);
            expect(wrapper.find('.td-assistant-vision-warning').exists()).toBe(false);
        });

        it('does not warn for unknown (null) vision even with image attachments', async () => {
            api.getAsync.mockResolvedValue({ data: { models: [{ id: 'mystery', vision: null }] } });
            const { wrapper } = mountPanel({
                assistant: { provider: 'openai', attachments: [{ kind: 'image' }] }
            });
            await flush();

            expect(wrapper.vm.showVisionWarning).toBe(false);
        });

        it('does not warn for a vision-false model when no image attachments are staged', async () => {
            api.getAsync.mockResolvedValue({ data: { models: [{ id: 'gpt-3.5-turbo', vision: false }] } });
            const { wrapper } = mountPanel({
                assistant: { provider: 'openai', attachments: [{ kind: 'text' }] }
            });
            await flush();

            expect(wrapper.vm.showVisionWarning).toBe(false);
        });

        it('string (env fallback) lists never warn (unknown vision)', () => {
            // env fallback for openai is the plain string list -> vision unknown
            const { wrapper } = mountPanel({
                assistant: { provider: 'openai', model: 'gpt-4o', attachments: [{ kind: 'image' }] }
            });
            expect(wrapper.vm.showVisionWarning).toBe(false);
        });
    });
});
