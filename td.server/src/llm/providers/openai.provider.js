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

// /v1/models mixes chat models with embeddings/audio/image/etc — exclude the
// families the assistant cannot drive through chat completions
const NON_CHAT = /(embed|whisper|tts|dall-e|moderation|audio|realtime|image|transcribe|babbage|davinci)/u;

/**
 * Lists the chat-capable models the OpenAI account offers as { id, vision }
 * objects. /v1/models carries no capability metadata (no per-model vision /
 * streaming / tool-call flags), so vision is reported as null (unknown) and no
 * filtering beyond the NON_CHAT family exclusion is applied — there is nothing
 * authoritative to filter on.
 * @param {Object} options { apiKey } BYO-key override
 * @returns {Promise<Array<{id: String, vision: null}>>}
 */
const listModels = async (options = {}) => {
    const apiKey = options.apiKey || env.get().config.LLM_OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OpenAI provider is not configured');
    }
    const client = new OpenAI({ apiKey });
    const ids = [];
    for await (const model of client.models.list()) {
        ids.push(model.id);
    }
    return ids.filter((id) => !NON_CHAT.test(id)).sort().
        map((id) => ({ id, vision: null }));
};

export default { name, isConfigured, createCompletionStream, listModels };
