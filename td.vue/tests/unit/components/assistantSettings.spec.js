import { BootstrapVue } from 'bootstrap-vue';
import { shallowMount, createLocalVue } from '@vue/test-utils';

import TdAssistantSettings from '@/components/Assistant/AssistantSettings.vue';

describe('components/Assistant/AssistantSettings.vue', () => {
    let localVue;
    let wrapper;
    let electronAPI;
    let bvModalShow;

    beforeEach(() => {
        electronAPI = {
            onOpenLlmSettings: jest.fn(),
            llmGetProviders: jest.fn().mockResolvedValue(['anthropic']),
            llmSetKey: jest.fn().mockResolvedValue(true)
        };
        window.electronAPI = electronAPI;

        localVue = createLocalVue();
        localVue.use(BootstrapVue);
        bvModalShow = jest.fn();
        wrapper = shallowMount(TdAssistantSettings, {
            localVue,
            mocks: {
                $t: (t) => t,
                $bvModal: { show: bvModalShow }
            }
        });
    });

    afterEach(() => {
        delete window.electronAPI;
    });

    it('registers the menu listener on mount', () => {
        expect(electronAPI.onOpenLlmSettings).toHaveBeenCalledTimes(1);
    });

    it('refresh loads the configured providers', async () => {
        await wrapper.vm.refresh();
        expect(wrapper.vm.configuredIds).toEqual(['anthropic']);
        expect(wrapper.vm.isConfigured('anthropic')).toBe(true);
        expect(wrapper.vm.isConfigured('openai')).toBe(false);
    });

    it('open refreshes, defaults the provider and shows the modal', async () => {
        await wrapper.vm.open();
        expect(electronAPI.llmGetProviders).toHaveBeenCalled();
        expect(wrapper.vm.selectedProvider).toBe('anthropic');
        expect(bvModalShow).toHaveBeenCalledWith('assistant-settings-modal');
    });

    it('save persists the key, clears the input and refreshes', async () => {
        wrapper.vm.selectedProvider = 'openai';
        wrapper.vm.keyInput = 'sk-test';
        await wrapper.vm.save();
        expect(electronAPI.llmSetKey).toHaveBeenCalledWith('openai', 'sk-test');
        expect(wrapper.vm.keyInput).toBe('');
        expect(electronAPI.llmGetProviders).toHaveBeenCalled();
    });

    it('save is a no-op without a provider and key', async () => {
        wrapper.vm.selectedProvider = null;
        wrapper.vm.keyInput = '';
        await wrapper.vm.save();
        expect(electronAPI.llmSetKey).not.toHaveBeenCalled();
    });

    it('clearKey removes the stored key for a provider', async () => {
        await wrapper.vm.clearKey('anthropic');
        expect(electronAPI.llmSetKey).toHaveBeenCalledWith('anthropic', '');
    });
});
