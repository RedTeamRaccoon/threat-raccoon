import { shallowMount } from '@vue/test-utils';

import TdMarkdown from '@/components/Markdown.vue';

describe('components/Markdown.vue', () => {
    const setup = (text) => shallowMount(TdMarkdown, {
        propsData: { text }
    });

    describe('rendering markdown', () => {
        it('renders headings', () => {
            const wrapper = setup('# Heading one');
            expect(wrapper.find('h1').exists()).toBe(true);
            expect(wrapper.find('h1').text()).toEqual('Heading one');
        });

        it('renders unordered lists', () => {
            const wrapper = setup('- one\n- two\n- three');
            expect(wrapper.find('ul').exists()).toBe(true);
            expect(wrapper.findAll('li')).toHaveLength(3);
        });

        it('renders ordered lists', () => {
            const wrapper = setup('1. first\n2. second');
            expect(wrapper.find('ol').exists()).toBe(true);
            expect(wrapper.findAll('li')).toHaveLength(2);
        });

        it('renders tables', () => {
            const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
            const wrapper = setup(md);
            expect(wrapper.find('table').exists()).toBe(true);
            expect(wrapper.findAll('th')).toHaveLength(2);
            expect(wrapper.findAll('td')).toHaveLength(2);
        });

        it('renders inline emphasis', () => {
            const wrapper = setup('this is **bold** text');
            expect(wrapper.find('strong').text()).toEqual('bold');
        });
    });

    describe('XSS safety (html disabled)', () => {
        it('escapes a raw script tag and injects no element', () => {
            const wrapper = setup('<script>alert(1)</script>');
            expect(wrapper.find('script').exists()).toBe(false);
            // the literal markup is rendered as escaped text
            expect(wrapper.html()).toContain('&lt;script&gt;');
            expect(wrapper.text()).toContain('alert(1)');
        });

        it('escapes a raw img onerror payload and injects no element', () => {
            const wrapper = setup('<img src=x onerror="alert(1)">');
            // no live img element is injected into the DOM
            expect(wrapper.find('img').exists()).toBe(false);
            // the markup is escaped, so it appears as text not live HTML
            expect(wrapper.html()).toContain('&lt;img');
            expect(wrapper.html()).not.toContain('<img');
        });
    });

    describe('empty input', () => {
        it('renders nothing for an empty string', () => {
            const wrapper = setup('');
            expect(wrapper.find('.td-markdown').exists()).toBe(false);
            expect(wrapper.text()).toBe('');
        });

        it('renders nothing for whitespace only', () => {
            const wrapper = setup('   \n  ');
            expect(wrapper.find('.td-markdown').exists()).toBe(false);
        });

        it('renders nothing for null input', () => {
            const wrapper = setup(null);
            expect(wrapper.find('.td-markdown').exists()).toBe(false);
            expect(wrapper.text()).toBe('');
        });

        it('renders nothing for undefined input', () => {
            const wrapper = shallowMount(TdMarkdown);
            expect(wrapper.find('.td-markdown').exists()).toBe(false);
        });
    });

    describe('linkify', () => {
        it('turns a bare URL into a link', () => {
            const wrapper = setup('see https://example.com for details');
            const link = wrapper.find('a');
            expect(link.exists()).toBe(true);
            expect(link.attributes('href')).toEqual('https://example.com');
        });
    });
});
