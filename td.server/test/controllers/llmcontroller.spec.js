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
        json (body) { this.body = body; this.writableEnded = true; return this; },
        on (event, handler) { (this.handlers || (this.handlers = {}))[event] = handler; }
    };
    return res;
};

const makeReq = (body, headers = {}) => {
    const handlers = {};
    return {
        body,
        headers,
        on (event, handler) { handlers[event] = handler; },
        emit (event) { if (handlers[event]) { handlers[event](); } }
    };
};

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

        it('wires abort to response close, not request close (Express 5 fires req close on body end)', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });
            let abortedDuringStream = null;
            sinon.stub(llmProviders, 'get').returns({
                createCompletionStream: async function* (_req, opts) {
                    yield { type: 'message_start' };
                    abortedDuringStream = opts.signal.aborted;
                    yield { type: 'message_stop' };
                }
            });

            const req = makeReq({ messages: [] });
            let reqCloseWired = false;
            req.on = (event) => { if (event === 'close') reqCloseWired = true; };
            const res = makeRes();
            await llmController.complete(req, res);

            // The request's `close` must NOT abort the stream (it fires as soon as the
            // request body is consumed under Express 5, which would kill the stream).
            expect(reqCloseWired).to.be.false;
            // The response's `close` is the correct client-disconnect signal.
            expect(res.handlers).to.have.property('close');
            // A normally-completing stream is never aborted.
            expect(abortedDuringStream).to.equal(false);
        });

        it('returns a 400 when the provider cannot be resolved', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });
            sinon.stub(llmProviders, 'get').throws(new Error('LLM provider anthropic is not configured'));

            const res = makeRes();
            await llmController.complete(makeReq({}), res);

            expect(res.statusCode).to.equal(400);
        });

        it('returns a 400 for an unknown provider without starting the SSE stream', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });

            const res = makeRes();
            await llmController.complete(makeReq({ provider: 'grok' }), res);

            expect(res.statusCode).to.equal(400);
            expect(res.body.message).to.equal('Bad Request');
            expect(res.body.details).to.contain('Unknown LLM provider');
            expect(res.chunks).to.be.empty;
        });

        it('returns a 400 for an unconfigured provider', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });

            const res = makeRes();
            await llmController.complete(makeReq({ provider: 'anthropic' }), res);

            expect(res.statusCode).to.equal(400);
            expect(res.body.details).to.contain('is not configured');
            expect(res.chunks).to.be.empty;
        });

        it('aborts the upstream request when the client disconnects mid-stream', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });
            const res = makeRes();
            let observedSignal = null;
            const fakeProvider = {
                createCompletionStream: async function* (_normalized, options) {
                    observedSignal = options.signal;
                    yield { type: 'message_start' };
                    // the client goes away mid-stream: the response fires 'close'
                    // while it is still writable (writableEnded false).
                    res.handlers.close();
                    if (options.signal.aborted) {
                        const err = new Error('Request was aborted.');
                        err.name = 'AbortError';
                        throw err;
                    }
                    yield { type: 'text_delta', text: 'should never be sent' };
                }
            };
            sinon.stub(llmProviders, 'get').returns(fakeProvider);

            await llmController.complete(makeReq({ messages: [] }), res);

            expect(observedSignal.aborted).to.be.true;
            expect(res.chunks).to.deep.equal(['data: {"type":"message_start"}\n\n']);
            expect(res.writableEnded).to.be.true;
        });

        it('emits a normalized error event when the provider throws mid-stream', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });
            const fakeProvider = {
                createCompletionStream: async function* () {
                    yield { type: 'message_start' };
                    // e.g. the SDK fails to parse a malformed / truncated upstream chunk
                    throw new SyntaxError('Unexpected end of JSON input');
                }
            };
            sinon.stub(llmProviders, 'get').returns(fakeProvider);

            const res = makeRes();
            await llmController.complete(makeReq({ messages: [] }), res);

            expect(res.chunks).to.have.length(2);
            const event = JSON.parse(res.chunks[1].slice('data: '.length));
            expect(event.type).to.equal('error');
            expect(event.message).to.equal('Unexpected end of JSON input');
            expect(res.writableEnded).to.be.true;
        });

        it('normalizes an upstream 401 without relaying the raw provider error', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });
            const fakeProvider = {
                createCompletionStream: async function* () {
                    yield { type: 'message_start' };
                    const err = new Error('401 {"error":{"message":"invalid x-api-key sk-ant-secret123"}}');
                    err.status = 401;
                    throw err;
                }
            };
            sinon.stub(llmProviders, 'get').returns(fakeProvider);

            const res = makeRes();
            await llmController.complete(makeReq({ messages: [] }), res);

            const event = JSON.parse(res.chunks[1].slice('data: '.length));
            expect(event.type).to.equal('error');
            expect(event.message).to.contain('401');
            expect(event.message).to.match(/authentication/iu);
            expect(event.message).to.not.contain('sk-ant-secret123');
            expect(res.writableEnded).to.be.true;
        });

        it('normalizes an upstream 429 to a rate-limit message', async () => {
            sinon.stub(env, 'get').returns({ config: { LLM_PROVIDER: 'anthropic', LLM_ALLOW_USER_KEY: 'false' } });
            const fakeProvider = {
                createCompletionStream: async function* () {
                    yield { type: 'message_start' };
                    const err = new Error('429 {"error":{"message":"tokens per minute exceeded; org=org-secret456"}}');
                    err.response = { status: 429 };
                    throw err;
                }
            };
            sinon.stub(llmProviders, 'get').returns(fakeProvider);

            const res = makeRes();
            await llmController.complete(makeReq({ messages: [] }), res);

            const event = JSON.parse(res.chunks[1].slice('data: '.length));
            expect(event.type).to.equal('error');
            expect(event.message).to.match(/rate limit/iu);
            expect(event.message).to.contain('429');
            expect(event.message).to.not.contain('org-secret456');
            expect(res.writableEnded).to.be.true;
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
