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

        it('lists chat-capable picker models, deduped, keeping a still-served configured default', async () => {
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
                        { id: 'no-capabilities-model' }
                    ]
                }
            });

            const models = await copilot.listModels();
            expect(models).to.deep.equal(['gpt-5', 'claude-opus-4.7', 'no-capabilities-model', 'gpt-4o']);
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
            expect(models).to.deep.equal(['gpt-5']);
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
