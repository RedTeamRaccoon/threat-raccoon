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
            logger.error(e);
            const message = e.message || 'LLM stream error';
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
    // Abort the upstream LLM call only when the CLIENT disconnects. Use the
    // response's `close` (not the request's): under Express 5 `req`'s `close`
    // fires as soon as the request body is consumed, which would abort the
    // stream before any event is sent. `res` `close` fires on a real client
    // disconnect, and at normal completion `writableEnded` is already true.
    res.on('close', () => {
        if (!res.writableEnded) {
            controller.abort();
        }
    });

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
