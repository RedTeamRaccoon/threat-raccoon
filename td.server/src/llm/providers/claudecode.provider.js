/**
 * @name claudecode
 * @description LLM provider adapter for Claude via OAuth (Claude Code).
 * Anthropic wire format, but authenticated with an OAuth token rather than an
 * API key: the SDK is configured with `authToken` (never `x-api-key`) plus the
 * `anthropic-beta: oauth-2025-04-20` default header.
 */
import Anthropic from '@anthropic-ai/sdk';

import env from '../../env/Env.js';
import { streamAnthropic } from './anthropicStream.js';

const name = 'claudecode';

const isConfigured = () => Boolean(env.get().config.LLM_CLAUDECODE_OAUTH_TOKEN);

const getModel = () => env.get().config.LLM_CLAUDECODE_MODEL ||
    env.get().config.LLM_ANTHROPIC_MODEL ||
    'claude-opus-4-8';

async function *createCompletionStream (normalizedRequest, options = {}) {
    const authToken = options.apiKey || env.get().config.LLM_CLAUDECODE_OAUTH_TOKEN;
    if (!authToken) {
        throw new Error('Claude Code provider is not configured');
    }

    const client = new Anthropic({
        authToken,
        defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' }
    });

    yield* streamAnthropic(client, {
        model: normalizedRequest.model || getModel(),
        normalizedRequest,
        signal: options.signal
    });
}

/**
 * Lists the models the Claude account offers (OAuth-authenticated) as
 * { id, vision } objects. Every Claude chat model supports vision and tool
 * use, so vision is always true here.
 * @param {Object} options { apiKey } BYO-token override
 * @returns {Promise<Array<{id: String, vision: Boolean}>>}
 */
const listModels = async (options = {}) => {
    const authToken = options.apiKey || env.get().config.LLM_CLAUDECODE_OAUTH_TOKEN;
    if (!authToken) {
        throw new Error('Claude Code provider is not configured');
    }
    const client = new Anthropic({
        authToken,
        defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' }
    });
    const models = [];
    for await (const model of client.models.list()) {
        models.push({ id: model.id, vision: true });
    }
    return models;
};

export default { name, isConfigured, createCompletionStream, listModels };
