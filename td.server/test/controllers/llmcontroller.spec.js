import { expect } from 'chai';
import sinon from 'sinon';

import env from '../../src/env/Env.js';
import llmController from '../../src/controllers/llmcontroller.js';
import llmProviders from '../../src/llm/providers';

const makeRes = () => {
    const res = {
        writableEnded: false,
        statusCode: null,
        headers: null,
        chunks: [],
        writeHead (status, headers) { this.statusCode = status; this.headers = headers; },
        flushHeaders () {},
        write (chunk) { this.chunks.push(chunk); },
        end () { this.writableEnded = true; },
        status (code) { this.statusCode = code; return this; },
        json (body) { this.body = body; this.writableEnded = true; return this; }
    };
    return res;
};

const makeReq = (body, headers = {}) => ({ body, headers, on () {} });

describe('controllers/llmcontroller.js', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('complete', () => {
        it('streams normalized events as SSE, bypassing responseWrapper', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });
            const fakeProvider = {
                // eslint-disable-next-line require-yield
                createCompletionStream: async function* () {
                    yield { type: 'message_start' };
                    yield { type: 'text_delta', text: 'hi' };
                    yield { type: 'message_stop' };
                }
            };
            sinon.stub(llmProviders, 'get').returns(fakeProvider);

            const res = makeRes();
            await llmController.complete(makeReq({ messages: [] }), res);

            expect(res.statusCode).to.equal(200);
            expect(res.headers['Content-Type']).to.equal('text/event-stream');
            expect(res.chunks).to.deep.equal([
                'data: {"type":"message_start"}\n\n',
                'data: {"type":"text_delta","text":"hi"}\n\n',
                'data: {"type":"message_stop"}\n\n'
            ]);
            expect(res.writableEnded).to.be.true;
        });

        it('returns a 400 when the provider cannot be resolved', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });
            sinon.stub(llmProviders, 'get').throws(new Error('LLM provider anthropic is not configured'));

            const res = makeRes();
            await llmController.complete(makeReq({}), res);

            expect(res.statusCode).to.equal(400);
        });

        it('uses the BYO key path when allowed and header present', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'true' } });
            const stub = sinon.stub(llmProviders, 'getAllowingUserKey').returns({
                createCompletionStream: async function* () { yield { type: 'message_stop' }; }
            });

            const res = makeRes();
            await llmController.complete(makeReq({}, { 'x-llm-user-key': 'user-key' }), res);

            expect(stub.calledOnce).to.be.true;
        });
    });

    describe('providers', () => {
        it('lists configured providers and the allowUserKey flag', () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'openai', LLM_ALLOW_USER_KEY: 'true' } });
            sinon.stub(llmProviders, 'configuredNames').returns(['openai']);

            const res = makeRes();
            llmController.providers(makeReq({}), res);

            expect(res.body.status).to.equal(200);
            expect(res.body.data).to.deep.equal({
                provider: 'openai',
                providers: ['openai'],
                allowUserKey: true
            });
        });
    });
});
