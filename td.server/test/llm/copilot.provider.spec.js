import axios from 'axios';
import { expect } from 'chai';
import sinon from 'sinon';

import copilot from '../../src/llm/providers/copilot.provider.js';
import env from '../../src/env/Env.js';

const drain = async (iterable) => {
    const out = [];
    for await (const event of iterable) {
        out.push(event);
    }
    return out;
};

describe('llm/providers/copilot.provider.js', () => {
    beforeEach(() => {
        copilot._resetTokenCache();
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('isConfigured', () => {
        it('is configured when the key is present', () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token' } });
            expect(copilot.isConfigured()).to.be.true;
        });

        it('is not configured without a key', () => {
            sinon.stub(env, 'get').returns({ config: {} });
            expect(copilot.isConfigured()).to.be.false;
        });
    });

    describe('createCompletionStream', () => {
        it('rejects cleanly when no key is configured', async () => {
            sinon.stub(env, 'get').returns({ config: {} });

            try {
                await drain(copilot.createCompletionStream({ messages: [] }));
                expect.fail('should have thrown');
            } catch (e) {
                expect(e.message).to.equal('Copilot provider is not configured');
            }
        });

        it('surfaces a clear error when the GitHub token exchange is rejected, without leaking the token', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_secret123' } });
            const axiosError = new Error('Request failed with status code 401');
            axiosError.response = { status: 401 };
            axiosError.config = { headers: { Authorization: 'token gho_secret123' } };
            sinon.stub(axios, 'get').rejects(axiosError);

            try {
                await drain(copilot.createCompletionStream({ messages: [] }));
                expect.fail('should have thrown');
            } catch (e) {
                expect(e.message).to.contain('Copilot token exchange failed');
                expect(e.message).to.contain('401');
                expect(e.message).to.not.contain('gho_secret123');
            }
        });

        it('surfaces a clear error when the token exchange fails without a response', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_secret123' } });
            sinon.stub(axios, 'get').rejects(new Error('connect ECONNREFUSED'));

            try {
                await drain(copilot.createCompletionStream({ messages: [] }));
                expect.fail('should have thrown');
            } catch (e) {
                expect(e.message).to.contain('Copilot token exchange failed');
                expect(e.message).to.not.contain('gho_secret123');
            }
        });

        it('does not cache a failed token exchange', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_secret123' } });
            const getStub = sinon.stub(axios, 'get').rejects(new Error('connect ECONNREFUSED'));

            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await drain(copilot.createCompletionStream({ messages: [] }));
                    expect.fail('should have thrown');
                } catch (e) {
                    expect(e.message).to.contain('Copilot token exchange failed');
                }
            }
            expect(getStub.callCount).to.equal(2);
        });
    });

    describe('listModels', () => {
        const stubExchangeAndModels = (modelsResponse) => {
            const getStub = sinon.stub(axios, 'get');
            getStub.withArgs(sinon.match(/copilot_internal/u)).resolves({
                data: { token: 'copilot-bearer', expires_at: (Date.now() / 1000) + 1800 }
            });
            getStub.withArgs(sinon.match(/\/models$/u)).resolves(modelsResponse);
            return getStub;
        };

        it('rejects cleanly when no key is configured', async () => {
            sinon.stub(env, 'get').returns({ config: {} });
            try {
                await copilot.listModels();
                expect.fail('should have thrown');
            } catch (e) {
                expect(e.message).to.equal('Copilot provider is not configured');
            }
        });

        it('lists chat-capable picker models as { id, vision } objects, deduped, keeping a still-served configured default', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token', LLM_COPILOT_MODEL: 'gpt-4o' } });
            stubExchangeAndModels({
                data: {
                    data: [
                        { id: 'gpt-5', capabilities: { type: 'chat' }, model_picker_enabled: true },
                        { id: 'gpt-5', capabilities: { type: 'chat' }, model_picker_enabled: true },
                        { id: 'claude-opus-4.7', capabilities: { type: 'chat' }, model_picker_enabled: true },
                        // internal helper and dated alias: hidden from the picker
                        { id: 'trajectory-compaction', capabilities: { type: 'chat' }, model_picker_enabled: false },
                        { id: 'gpt-4o-2024-11-20', capabilities: { type: 'chat' }, model_picker_enabled: false },
                        // the configured default is picker-hidden but still served -> kept
                        { id: 'gpt-4o', capabilities: { type: 'chat' }, model_picker_enabled: false },
                        { id: 'text-embedding-3-small', capabilities: { type: 'embeddings' }, model_picker_enabled: false },
                        // no capabilities object at all -> type is not 'chat' -> excluded
                        { id: 'no-capabilities-model' }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal([
                { id: 'gpt-5', vision: false },
                { id: 'claude-opus-4.7', vision: false },
                { id: 'gpt-4o', vision: false }
            ]);
        });

        it('maps the vision capability flag', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token' } });
            stubExchangeAndModels({
                data: {
                    data: [
                        { id: 'gpt-4o', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true, vision: true } }, model_picker_enabled: true },
                        { id: 'gpt-3.5-turbo', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true, vision: false } }, model_picker_enabled: true },
                        { id: 'legacy-no-vision-flag', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true } }, model_picker_enabled: true }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal([
                { id: 'gpt-4o', vision: true },
                { id: 'gpt-3.5-turbo', vision: false },
                { id: 'legacy-no-vision-flag', vision: false }
            ]);
        });

        it('excludes responses-only models (supported_endpoints without /chat/completions)', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token' } });
            stubExchangeAndModels({
                data: {
                    data: [
                        { id: 'gpt-5.4', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true } }, supported_endpoints: ['/chat/completions'], model_picker_enabled: true },
                        // responses-only: all supports flags true but no /chat/completions
                        { id: 'gpt-5.5', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true, vision: true } }, supported_endpoints: ['/responses', 'ws:/responses'], model_picker_enabled: true }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal([{ id: 'gpt-5.4', vision: false }]);
        });

        it('keeps models whose supported_endpoints is absent (legacy payload shape)', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token' } });
            stubExchangeAndModels({
                data: {
                    data: [
                        { id: 'gemini-2.5-pro', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true, vision: true } }, model_picker_enabled: true }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal([{ id: 'gemini-2.5-pro', vision: true }]);
        });

        it('excludes embeddings models', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token' } });
            stubExchangeAndModels({
                data: {
                    data: [
                        { id: 'gpt-4o', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true } }, model_picker_enabled: true },
                        { id: 'text-embedding-3-small', capabilities: { type: 'embeddings' }, model_picker_enabled: true }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal([{ id: 'gpt-4o', vision: false }]);
        });

        it('excludes models with streaming or tool_calls explicitly false', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token' } });
            stubExchangeAndModels({
                data: {
                    data: [
                        { id: 'ok', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true } }, model_picker_enabled: true },
                        { id: 'no-stream', capabilities: { type: 'chat', supports: { streaming: false, tool_calls: true } }, model_picker_enabled: true },
                        { id: 'no-tools', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: false } }, model_picker_enabled: true },
                        // supports present but flag missing -> treated as not declared -> excluded
                        { id: 'missing-tools', capabilities: { type: 'chat', supports: { streaming: true } }, model_picker_enabled: true }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal([{ id: 'ok', vision: false }]);
        });

        it('drops a configured default the account no longer serves', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token', LLM_COPILOT_MODEL: 'gpt-4o' } });
            stubExchangeAndModels({
                data: {
                    data: [
                        { id: 'gpt-5', capabilities: { type: 'chat' }, model_picker_enabled: true }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal([{ id: 'gpt-5', vision: false }]);
        });

        it('does not re-add a configured default that is responses-only (fails the compatibility filter)', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_token', LLM_COPILOT_MODEL: 'gpt-5.5' } });
            stubExchangeAndModels({
                data: {
                    data: [
                        { id: 'gpt-5.4', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true } }, supported_endpoints: ['/chat/completions'], model_picker_enabled: true },
                        // pinned default but responses-only -> must NOT reappear
                        { id: 'gpt-5.5', capabilities: { type: 'chat', supports: { streaming: true, tool_calls: true, vision: true } }, supported_endpoints: ['/responses'], model_picker_enabled: false }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal([{ id: 'gpt-5.4', vision: false }]);
        });

        it('normalizes upstream errors without leaking the bearer', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_COPILOT_API_KEY: 'gho_secret123' } });
            const getStub = sinon.stub(axios, 'get');
            getStub.withArgs(sinon.match(/copilot_internal/u)).resolves({
                data: { token: 'copilot-bearer-secret', expires_at: (Date.now() / 1000) + 1800 }
            });
            const axiosError = new Error('Request failed with status code 403');
            axiosError.response = { status: 403 };
            axiosError.config = { headers: { Authorization: 'Bearer copilot-bearer-secret' } };
            getStub.withArgs(sinon.match(/\/models$/u)).rejects(axiosError);

            try {
                await copilot.listModels();
                expect.fail('should have thrown');
            } catch (e) {
                expect(e.message).to.contain('Copilot model listing failed');
                expect(e.message).to.contain('403');
                expect(e.message).to.not.contain('copilot-bearer-secret');
            }
        });
    });
});
