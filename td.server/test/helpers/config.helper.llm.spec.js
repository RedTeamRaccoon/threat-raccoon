import { expect } from 'chai';

import { buildConfig } from '../../src/helpers/config.helper.js';

describe('config.helper.js LLM/MCP flags', () => {
    it('emits the canonical provider shape but never keys', () => {
        const { value } = buildConfig({
            LLM_ENABLED: 'true',
            LLM_PROVIDER: 'anthropic',
            LLM_ALLOW_USER_KEY: 'false',
            MCP_HTTP_ENABLED: 'true',
            LLM_ANTHROPIC_API_KEY: 'sk-ant-secret',
            LLM_ANTHROPIC_MODEL: 'claude-opus-4-8',
            LLM_OPENAI_API_KEY: 'sk-secret',
            LOCALES_ALLOWED: '[]'
        });

        expect(value.llmEnabled).to.be.true;
        expect(value.llmAllowUserKey).to.be.false;
        expect(value.mcpHttpEnabled).to.be.true;
        expect(value.llmDefaultProvider).to.equal('anthropic');
        expect(value.llmDefaultModel).to.equal('claude-opus-4-8');

        expect(value.llmProviders).to.deep.equal([
            { id: 'anthropic', label: 'Anthropic Claude', models: [{ id: 'claude-opus-4-8', label: 'claude-opus-4-8' }], default: 'claude-opus-4-8' },
            { id: 'openai', label: 'OpenAI', models: [{ id: 'gpt-4o', label: 'gpt-4o' }], default: 'gpt-4o' }
        ]);

        // no secret value should leak through
        const serialized = JSON.stringify(value);
        expect(serialized).to.not.contain('sk-ant-secret');
        expect(serialized).to.not.contain('sk-secret');
    });

    it('exposes llmLocalSession when LLM_LOCAL_SESSION is enabled', () => {
        const { value } = buildConfig({ LLM_LOCAL_SESSION: 'true', LOCALES_ALLOWED: '[]' });
        expect(value.llmLocalSession).to.be.true;
    });

    it('defaults flags off and providers empty when nothing is configured', () => {
        const { value } = buildConfig({ LOCALES_ALLOWED: '[]' });
        expect(value.llmEnabled).to.be.false;
        expect(value.mcpHttpEnabled).to.be.false;
        expect(value.llmAllowUserKey).to.be.false;
        expect(value.llmLocalSession).to.be.false;
        expect(value.llmDefaultProvider).to.be.null;
        expect(value.llmDefaultModel).to.be.null;
        expect(value.llmProviders).to.deep.equal([]);
    });

    it('uses the env-configured model and lists claudecode when its oauth token is present', () => {
        const { value } = buildConfig({
            LLM_PROVIDER: 'claudecode',
            LLM_CLAUDECODE_OAUTH_TOKEN: 'oauth-token',
            LLM_CLAUDECODE_MODEL: 'claude-opus-4-8',
            LLM_OPENAI_API_KEY: 'sk-secret',
            LLM_OPENAI_MODEL: 'gpt-4o-mini',
            LOCALES_ALLOWED: '[]'
        });

        expect(value.llmDefaultProvider).to.equal('claudecode');
        expect(value.llmDefaultModel).to.equal('claude-opus-4-8');
        expect(value.llmProviders.map((p) => p.id)).to.deep.equal(['openai', 'claudecode']);
        // env-configured model is reflected, not a hardcoded default
        expect(value.llmProviders.find((p) => p.id === 'openai').default).to.equal('gpt-4o-mini');
    });
});
