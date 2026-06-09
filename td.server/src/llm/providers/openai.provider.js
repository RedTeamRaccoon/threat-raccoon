/**
 * @name openai
 * @description LLM provider adapter for the OpenAI chat-completions API (API key).
 */
import OpenAI from 'openai';

import env from '../../env/Env.js';
import { streamOpenAi } from './openaiTranslate.js';

const name = 'openai';

const isConfigured = () => Boolean(env.get().config.LLM_OPENAI_API_KEY);

const getModel = () => env.get().config.LLM_OPENAI_MODEL || 'gpt-4o';

async function *createCompletionStream (normalizedRequest, options = {}) {
    const apiKey = options.apiKey || env.get().config.LLM_OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OpenAI provider is not configured');
    }

    const client = new OpenAI({ apiKey });
    yield* streamOpenAi(client, {
        model: normalizedRequest.model || getModel(),
        normalizedRequest,
        signal: options.signal
    });
}

export default { name, isConfigured, createCompletionStream };
