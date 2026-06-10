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
});
