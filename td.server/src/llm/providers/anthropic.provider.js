/**
 * @name anthropic
 * @description LLM provider adapter for the Anthropic Messages API (API key).
 * Primary reference implementation: Claude Opus 4.8, adaptive thinking, 1:1 tool use.
 */
import Anthropic from '@anthropic-ai/sdk';

import env from '../../env/Env.js';
import { streamAnthropic } from './anthropicStream.js';

const name = 'anthropic';

const isConfigured = () => Boolean(env.get().config.LLM_ANTHROPIC_API_KEY);

const getModel = () => env.get().config.LLM_ANTHROPIC_MODEL || 'claude-opus-4-8';

async function *createCompletionStream (normalizedRequest, options = {}) {
    const apiKey = options.apiKey || env.get().config.LLM_ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error('Anthropic provider is not configured');
    }

    const client = new Anthropic({ apiKey });
    yield* streamAnthropic(client, {
        model: normalizedRequest.model || getModel(),
        normalizedRequest,
        signal: options.signal
    });
}

/**
 * Lists the models the Anthropic account offers as { id, vision } objects.
 * Every Claude chat model supports vision and tool use, so vision is always
 * true here.
 * @param {Object} options { apiKey } BYO-key override
 * @returns {Promise<Array<{id: String, vision: Boolean}>>}
 */
const listModels = async (options = {}) => {
    const apiKey = options.apiKey || env.get().config.LLM_ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error('Anthropic provider is not configured');
    }
    const client = new Anthropic({ apiKey });
    const models = [];
    for await (const model of client.models.list()) {
        models.push({ id: model.id, vision: true });
    }
    return models;
};

export default { name, isConfigured, createCompletionStream, listModels };
