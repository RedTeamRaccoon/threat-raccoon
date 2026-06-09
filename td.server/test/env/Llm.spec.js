import { expect } from 'chai';

import { Env } from '../../src/env/Env.js';
import Llm from '../../src/env/Llm.js';

describe('env/Llm.js', () => {
    let llmEnv;

    beforeEach(() => {
        llmEnv = new Llm();
    });

    it('extends Env', () => {
        expect(llmEnv).is.instanceOf(Env);
    });

    it('is named Llm', () => {
        expect(llmEnv.name).to.eq('Llm');
    });

    it('uses the LLM_ prefix', () => {
        expect(llmEnv.prefix).to.eq('LLM_');
    });

    it('defaults ANTHROPIC_MODEL to claude-opus-4-8', () => {
        const value = llmEnv.properties.find((x) => x.key === 'ANTHROPIC_MODEL').defaultValue;
        expect(value).to.equal('claude-opus-4-8');
    });

    it('defaults PROVIDER to anthropic', () => {
        const value = llmEnv.properties.find((x) => x.key === 'PROVIDER').defaultValue;
        expect(value).to.equal('anthropic');
    });

    it('defaults ALLOW_USER_KEY to false', () => {
        const value = llmEnv.properties.find((x) => x.key === 'ALLOW_USER_KEY').defaultValue;
        expect(value).to.be.false;
    });

    it('treats provider keys as optional', () => {
        ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'COPILOT_API_KEY', 'CLAUDECODE_OAUTH_TOKEN'].forEach((key) => {
            expect(llmEnv.properties.find((x) => x.key === key).required).to.be.false;
        });
    });
});
