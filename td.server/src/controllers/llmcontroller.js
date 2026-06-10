/**
 * @name llmcontroller
 * @description Server-mode LLM proxy. `complete` streams a provider's output
 * as Server-Sent Events, bypassing the standard responseWrapper. `providers`
 * lists the providers that are enabled server-side.
 */
import env from '../env/Env.js';
import errors from './errors.js';
import llmProviders from '../llm/providers';
import loggerHelper from '../helpers/logger.helper.js';
import responseWrapper from './responseWrapper.js';

const logger = loggerHelper.get('controllers/llmcontroller.js');

/**
 * Resolves the per-user BYO key, if the feature is enabled and a key was sent.
 * @param {Object} req
 * @returns {String|null}
 */
const resolveUserKey = (req) => {
    if (env.get().config.LLM_ALLOW_USER_KEY === 'true' || env.get().config.LLM_ALLOW_USER_KEY === true) {
        return req.headers['x-llm-user-key'] || null;
    }
    return null;
};

/**
 * Builds the normalized request from the request body.
 * @param {Object} body
 * @returns {Object}
 */
const buildNormalizedRequest = (body = {}) => ({
    model: body.model,
    system: body.system,
    messages: Array.isArray(body.messages) ? body.messages : [],
    tools: Array.isArray(body.tools) ? body.tools : [],
    max_tokens: body.max_tokens,
    thinking: body.thinking,
    stream: true
});

const write = (res, event) => {
    if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
};

/**
 * Normalizes an upstream provider error into a safe, user-facing message.
 * Status-coded errors get a fixed message so raw provider error bodies
 * (which may echo request details or credentials) are never relayed.
 * @param {Error} e
 * @returns {String}
 */
const streamErrorMessage = (e) => {
    const status = e.status || (e.response && e.response.status);
    if (status === 401 || status === 403) {
        return `LLM provider rejected the request: authentication failed (${status})`;
    }
    if (status === 429) {
        return 'LLM provider rate limit exceeded (429), please retry later';
    }
    return e.message || 'LLM stream error';
};

/**
 * Pumps a provider's normalized event stream to the response as SSE.
 * @param {Object} provider
 * @param {Object} normalized
 * @param {Object} options { signal, apiKey }
 * @param {Object} res
 */
const pipeStream = async (provider, normalized, options, res) => {
    try {
        for await (const event of provider.createCompletionStream(normalized, options)) {
            if (res.writableEnded) {
                break;
            }
            write(res, event);
        }
    } catch (e) {
        if (options.signal.aborted) {
            logger.debug('LLM stream aborted by client');
        } else {
            // log the normalized message only: raw provider/transport errors can
            // carry request config (e.g. auth headers) that must not reach the logs
            const message = streamErrorMessage(e);
            logger.error(`LLM stream failed: ${message}`);
            write(res, { type: 'error', message, error: { message } });
        }
    } finally {
        if (!res.writableEnded) {
            res.end();
        }
    }
};

const complete = async (req, res) => {
    const body = req.body || {};
    const providerName = body.provider || env.get().config.LLM_PROVIDER;
    const userKey = resolveUserKey(req);

    let provider;
    try {
        provider = userKey
            ? llmProviders.getAllowingUserKey(providerName)
            : llmProviders.get(providerName);
    } catch (e) {
        logger.warn(`LLM provider resolution failed: ${e.message}`);
        return errors.badRequest(e.message, res, logger);
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    await pipeStream(provider, buildNormalizedRequest(body), { signal: controller.signal, apiKey: userKey }, res);
    return res;
};

const providers = (req, res) => responseWrapper.sendResponse(() => ({
    provider: env.get().config.LLM_PROVIDER,
    providers: llmProviders.configuredNames(),
    allowUserKey: env.get().config.LLM_ALLOW_USER_KEY === 'true' ||
        env.get().config.LLM_ALLOW_USER_KEY === true
}), req, res, logger);

export default { complete, providers };
