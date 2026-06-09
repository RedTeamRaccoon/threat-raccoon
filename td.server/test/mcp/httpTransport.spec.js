import { expect } from 'chai';
import sinon from 'sinon';

import { createHttpTransport, deriveOwner } from '../../src/mcp/httpTransport.js';
import env from '../../src/env/Env.js';

const makeRes = () => ({
    statusCode: null,
    body: null,
    text: null,
    headersSent: false,
    status (code) { this.statusCode = code; return this; },
    json (body) { this.body = body; return this; },
    send (text) { this.text = text; return this; }
});

const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
};

// Fake transport whose first handleRequest "initializes" the session.
const makeFakeTransport = ({ onsessioninitialized }, sessionId) => {
    const t = {
        sessionId: undefined,
        onclose: null,
        handleRequest: sinon.stub().callsFake(async () => {
            if (!t.sessionId) {
                t.sessionId = sessionId;
                onsessioninitialized(sessionId);
            }
        })
    };
    return t;
};

describe('mcp/httpTransport.js', () => {
    let envStub;

    beforeEach(() => {
        envStub = sinon.stub(env, 'get').returns({ config: {} });
    });

    afterEach(() => {
        sinon.restore();
    });

    const buildTransport = (createTransportSpy) => createHttpTransport({
        createStore: () => ({ loadModel: async () => ({}), saveModel: async () => {} }),
        createTransport: createTransportSpy,
        createServer: async () => ({ connect: async () => {} })
    });

    describe('deriveOwner', () => {
        it('produces different owners for different authenticated users', () => {
            const a = deriveOwner({ user: { email: 'a@x' }, provider: { name: 'github', access_token: 't1' } });
            const b = deriveOwner({ user: { email: 'b@x' }, provider: { name: 'github', access_token: 't2' } });
            expect(a).to.not.equal(b);
        });

        it('is stable for the same user across token refresh', () => {
            const a1 = deriveOwner({ user: { email: 'a@x' }, provider: { name: 'github', access_token: 'old' } });
            const a2 = deriveOwner({ user: { email: 'a@x' }, provider: { name: 'github', access_token: 'new' } });
            expect(a1).to.equal(a2);
        });
    });

    describe('Origin protection', () => {
        it('rejects a disallowed Origin with 403 before creating a session', async () => {
            envStub.returns({ config: { MCP_ALLOWED_ORIGINS: 'https://app.example.com' } });
            const createTransportSpy = sinon.spy();
            const { handlePost } = buildTransport(createTransportSpy);

            const req = { headers: { origin: 'https://evil.example.com' }, body: initBody, user: { email: 'a@x' }, provider: { name: 'github' } };
            const res = makeRes();
            await handlePost(req, res);

            expect(res.statusCode).to.equal(403);
            expect(createTransportSpy.called).to.be.false;
        });

        it('allows a request with no Origin header (non-browser MCP client)', async () => {
            envStub.returns({ config: { MCP_ALLOWED_ORIGINS: 'https://app.example.com' } });
            let captured;
            const createTransport = (opts) => { captured = makeFakeTransport(opts, 'sess-1'); return captured; };
            const { handlePost } = buildTransport(createTransport);

            const req = { headers: {}, body: initBody, user: { email: 'a@x' }, provider: { name: 'github' } };
            await handlePost(req, makeRes());

            expect(captured.handleRequest.calledOnce).to.be.true;
        });
    });

    describe('per-session owner binding', () => {
        it('lets the creating user reuse the session but blocks a different user', async () => {
            let captured;
            const createTransport = (opts) => { captured = makeFakeTransport(opts, 'sess-1'); return captured; };
            const { handlePost, handleSession } = buildTransport(createTransport);

            // User A creates the session
            const reqA = { headers: {}, body: initBody, user: { email: 'a@x' }, provider: { name: 'github' } };
            await handlePost(reqA, makeRes());
            expect(captured.sessionId).to.equal('sess-1');
            expect(captured.handleRequest.callCount).to.equal(1);

            // User A reuses it -> allowed
            const reqAReuse = { headers: { 'mcp-session-id': 'sess-1' }, body: {}, user: { email: 'a@x' }, provider: { name: 'github' } };
            await handlePost(reqAReuse, makeRes());
            expect(captured.handleRequest.callCount).to.equal(2);

            // User B presents A's session id -> 403, transport NOT driven
            const reqB = { headers: { 'mcp-session-id': 'sess-1' }, body: {}, user: { email: 'b@x' }, provider: { name: 'github' } };
            const resB = makeRes();
            await handlePost(reqB, resB);
            expect(resB.statusCode).to.equal(403);
            expect(captured.handleRequest.callCount).to.equal(2);

            // Same cross-user rejection on the GET/DELETE path
            const resBGet = makeRes();
            handleSession(reqB, resBGet);
            expect(resBGet.statusCode).to.equal(403);
            expect(captured.handleRequest.callCount).to.equal(2);
        });
    });
});
