import { expect } from 'chai';
import sinon from 'sinon';

import anthropic from '../../src/llm/providers/anthropic.provider.js';
import llmProviders from '../../src/llm/providers/index.js';
import openai from '../../src/llm/providers/openai.provider.js';

describe('llm/providers/index.js', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('all', () => {
        it('is an immutable object', () => {
            expect(() => { llmProviders.all.foo = 'bar'; }).to.throw();
        });

        it('has the four v1 providers', () => {
            expect(llmProviders.all.anthropic).not.to.be.undefined;
            expect(llmProviders.all.openai).not.to.be.undefined;
            expect(llmProviders.all.copilot).not.to.be.undefined;
            expect(llmProviders.all.claudecode).not.to.be.undefined;
        });
    });

    describe('get', () => {
        it('returns a configured provider', () => {
            sinon.stub(anthropic, 'isConfigured').returns(true);
            expect(llmProviders.get('anthropic')).to.equal(anthropic);
        });

        it('throws for an unknown provider', () => {
            expect(() => llmProviders.get('grok')).to.throw('Unknown LLM provider');
        });

        it('throws for an unconfigured provider', () => {
            sinon.stub(openai, 'isConfigured').returns(false);
            expect(() => llmProviders.get('openai')).to.throw('is not configured');
        });
    });

    describe('getAllowingUserKey', () => {
        it('returns a known provider without the configured check', () => {
            sinon.stub(openai, 'isConfigured').returns(false);
            expect(llmProviders.getAllowingUserKey('openai')).to.equal(openai);
        });

        it('throws for an unknown provider', () => {
            expect(() => llmProviders.getAllowingUserKey('grok')).to.throw('Unknown LLM provider');
        });
    });

    describe('configuredNames', () => {
        it('lists only configured providers', () => {
            sinon.stub(anthropic, 'isConfigured').returns(true);
            sinon.stub(openai, 'isConfigured').returns(false);
            const names = llmProviders.configuredNames();
            expect(names).to.include('anthropic');
            expect(names).to.not.include('openai');
        });
    });
});
