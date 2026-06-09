/**
 * @name httpTransport
 * @description Mounts the MCP StreamableHTTPServerTransport for Express. Manages
 * one transport per `Mcp-Session-Id`, with two security properties:
 *
 *  - DNS-rebinding / Origin protection: when MCP_ALLOWED_ORIGINS / MCP_ALLOWED_HOSTS
 *    are configured, the transport enables `enableDnsRebindingProtection` and a
 *    request carrying a disallowed Origin is rejected (403) before it reaches a
 *    session.
 *  - Per-session owner binding: each session is bound to the authenticated user
 *    that created it (derived from the verified bearer payload). A session id
 *    presented by a different user is rejected (403) — a leaked/guessed id cannot
 *    be replayed to reuse another user's request-scoped store (their token + repo).
 */
import crypto, { randomUUID } from 'crypto';

import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createMcpServer } from './server.js';
import env from '../env/Env.js';
import loggerHelper from '../helpers/logger.helper.js';

const logger = loggerHelper.get('mcp/httpTransport.js');

const jsonRpcError = (res, status, code, message) => res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null
});

const parseList = (raw) => (raw
    ? String(raw).split(',').
        map((s) => s.trim()).
        filter(Boolean)
    : []);

const getAllowedOrigins = () => parseList(env.get().config.MCP_ALLOWED_ORIGINS);
const getAllowedHosts = () => parseList(env.get().config.MCP_ALLOWED_HOSTS);

/**
 * Transport-level DNS-rebinding protection options, active only when an
 * allow-list is configured.
 * @returns {Object}
 */
export const transportSecurityOptions = () => {
    const allowedOrigins = getAllowedOrigins();
    const allowedHosts = getAllowedHosts();
    if (allowedOrigins.length === 0 && allowedHosts.length === 0) {
        return {};
    }
    return { enableDnsRebindingProtection: true, allowedOrigins, allowedHosts };
};

/**
 * Explicit Origin pre-check (defence-in-depth alongside the transport option).
 * Only a present-but-disallowed Origin is rejected; non-browser MCP clients send
 * no Origin and are allowed (they are still bearer-authenticated).
 * @param {Object} req
 * @returns {Boolean}
 */
export const originAllowed = (req) => {
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.length === 0) {
        return true;
    }
    const origin = req.headers && req.headers.origin;
    if (!origin) {
        return true;
    }
    return allowedOrigins.includes(origin);
};

/**
 * Derives a stable owner identity for the authenticated request from the verified
 * bearer payload (req.user is stable across token refresh; falls back to a hash of
 * the access token, then 'anonymous').
 * @param {Object} req
 * @returns {String}
 */
export const deriveOwner = (req) => {
    let identity = 'anonymous';
    if (req.user) {
        identity = JSON.stringify(req.user);
    } else if (req.provider && req.provider.access_token) {
        identity = `tok:${crypto.createHash('sha256').update(req.provider.access_token).
            digest('hex')}`;
    }
    const provider = (req.provider && req.provider.name) || '';
    return crypto.createHash('sha256').update(`${provider}|${identity}`).
        digest('hex');
};

const defaultCreateTransport = ({ onsessioninitialized }) => new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized,
    ...transportSecurityOptions()
});

const startSession = async (req, deps, owner) => {
    const { sessions, createTransport, createServer, createStore } = deps;
    const transport = createTransport({
        onsessioninitialized: (sid) => { sessions.set(sid, { transport, owner }); }
    });
    transport.onclose = () => {
        if (transport.sessionId) {
            sessions.delete(transport.sessionId);
        }
    };
    const server = await createServer(createStore(req));
    await server.connect(transport);
    return transport;
};

const makeHandlePost = (deps) => async (req, res) => {
    try {
        if (!originAllowed(req)) {
            return jsonRpcError(res, 403, -32003, 'Forbidden: origin not allowed');
        }

        const owner = deriveOwner(req);
        const sessionId = req.headers['mcp-session-id'];
        const existing = sessionId ? deps.sessions.get(sessionId) : undefined;

        if (existing) {
            if (existing.owner !== owner) {
                logger.audit('Rejected MCP session reuse by a different user');
                return jsonRpcError(res, 403, -32003, 'Forbidden: session belongs to another user');
            }
            return await existing.transport.handleRequest(req, res, req.body);
        }

        if (sessionId || !isInitializeRequest(req.body)) {
            return jsonRpcError(res, 400, -32000, 'Bad Request: no valid session ID provided');
        }

        const transport = await startSession(req, deps, owner);
        return await transport.handleRequest(req, res, req.body);
    } catch (e) {
        logger.error(e);
        if (!res.headersSent) {
            return jsonRpcError(res, 500, -32603, 'Internal server error');
        }
        return res;
    }
};

const makeHandleSession = (deps) => (req, res) => {
    if (!originAllowed(req)) {
        return jsonRpcError(res, 403, -32003, 'Forbidden: origin not allowed');
    }
    const sessionId = req.headers['mcp-session-id'];
    const existing = sessionId ? deps.sessions.get(sessionId) : undefined;
    if (!existing) {
        return res.status(400).send('Invalid or missing session ID');
    }
    if (existing.owner !== deriveOwner(req)) {
        logger.audit('Rejected MCP session reuse by a different user');
        return res.status(403).send('Forbidden: session belongs to another user');
    }
    return existing.transport.handleRequest(req, res);
};

/**
 * @param {Object} args
 * @param {Function} args.createStore (req) => modelStore — builds the request-scoped store
 * @param {Function} [args.createTransport] injectable transport factory (tests)
 * @param {Function} [args.createServer] injectable MCP server factory (tests)
 * @returns {{ handlePost: Function, handleSession: Function }}
 */
export const createHttpTransport = ({
    createStore,
    createTransport = defaultCreateTransport,
    createServer = createMcpServer
}) => {
    // sessionId -> { transport, owner }
    const deps = { sessions: new Map(), createStore, createTransport, createServer };
    return { handlePost: makeHandlePost(deps), handleSession: makeHandleSession(deps) };
};

export default { createHttpTransport };
