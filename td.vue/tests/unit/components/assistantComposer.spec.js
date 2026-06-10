import { BootstrapVue } from 'bootstrap-vue';
import { mount, createLocalVue } from '@vue/test-utils';

import TdAssistantComposer from '@/components/Assistant/AssistantComposer.vue';

describe('components/Assistant/AssistantComposer.vue', () => {
    const mountComposer = (propsData = { busy: false, canSend: true }) => {
        const store = {
            state: { assistant: { attachments: [] } },
            dispatch: jest.fn()
        };
        const localVue = createLocalVue();
        localVue.use(BootstrapVue);
        const wrapper = mount(TdAssistantComposer, {
            localVue,
            propsData,
            mocks: { $t: (t) => t, $store: store }
        });
        return { wrapper, store };
    };

    it('emits send with the trimmed message', async () => {
        const { wrapper } = mountComposer();
        await wrapper.find('#assistant-input').setValue('  build a model  ');
        wrapper.vm.submit();
        expect(wrapper.emitted('send')).toEqual([['build a model']]);
    });

    it('clears the input after sending', async () => {
        const { wrapper } = mountComposer();
        const input = wrapper.find('#assistant-input');
        await input.setValue('build a model');
        wrapper.vm.submit();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.text).toBe('');
        expect(input.element.value).toBe('');
    });

    it('clears the input even when the send handler throws', async () => {
        const { wrapper } = mountComposer();
        wrapper.vm.$on('send', () => { throw new Error('listener blew up'); });
        await wrapper.find('#assistant-input').setValue('boom');
        expect(() => wrapper.vm.submit()).toThrow();
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.text).toBe('');
    });

    it('does not send when empty or busy', async () => {
        const { wrapper } = mountComposer({ busy: true, canSend: true });
        await wrapper.setData({ text: 'queued' });
        wrapper.vm.submit();
        expect(wrapper.emitted('send')).toBeUndefined();
    });
});
