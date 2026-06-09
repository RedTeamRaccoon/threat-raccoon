/**
 * @name openaiTranslate
 * @description Translates between Threat Dragon's normalized (Anthropic
 * content-block superset) request shape and the OpenAI chat-completions wire
 * format, and maps OpenAI streaming deltas back onto the normalized SSE events.
 * Shared by the `openai` and `copilot` adapters (Copilot is OpenAI-compatible).
 */

const normalizeContent = (content) => {
    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
    }
    return Array.isArray(content) ? content : [];
};

const toolResultContentToString = (content) => {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content.
            map((block) => (block && block.type === 'text' ? block.text : JSON.stringify(block))).
            join('');
    }
    return JSON.stringify(content ?? '');
};

const assistantMessage = (blocks) => {
    const textParts = [];
    const toolCalls = [];
    for (const block of blocks) {
        if (block.type === 'text') {
            textParts.push(block.text);
        } else if (block.type === 'tool_use') {
            toolCalls.push({
                id: block.id,
                type: 'function',
                function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
            });
        }
    }
    const message = { role: 'assistant', content: textParts.join('') || null };
    if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
    }
    return [message];
};

const userMessages = (blocks) => {
    const out = [];
    const textParts = [];
    for (const block of blocks) {
        if (block.type === 'text') {
            textParts.push(block.text);
        } else if (block.type === 'tool_result') {
            out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: toolResultContentToString(block.content) });
        }
    }
    if (textParts.length > 0) {
        out.unshift({ role: 'user', content: textParts.join('') });
    }
    return out;
};

/**
 * Converts normalized messages (content-block superset) into OpenAI messages.
 * - text blocks become message content
 * - assistant tool_use blocks become `tool_calls`
 * - user tool_result blocks become separate `role: 'tool'` messages
 * @param {Object} req normalized request
 * @returns {Object[]}
 */
export const toOpenAiMessages = (req) => {
    const out = [];

    if (req.system) {
        out.push({ role: 'system', content: req.system });
    }

    for (const msg of req.messages || []) {
        const blocks = normalizeContent(msg.content);
        const translated = msg.role === 'assistant' ? assistantMessage(blocks) : userMessages(blocks);
        out.push(...translated);
    }

    return out;
};

/**
 * Converts normalized tool definitions into OpenAI function tools.
 * @param {Object[]} tools
 * @returns {Object[]}
 */
export const toOpenAiTools = (tools) => (tools || []).map((tool) => ({
    type: 'function',
    function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
    }
}));

const mapFinishReason = (reason) => {
    switch (reason) {
    case 'tool_calls':
        return 'tool_use';
    case 'length':
        return 'max_tokens';
    case 'stop':
        return 'end_turn';
    default:
        return 'end_turn';
    }
};

/**
 * Maps a raw OpenAI chat-completions stream onto normalized events.
 * @param {AsyncIterable} raw
 * @returns {AsyncGenerator}
 */
function *mapToolCallDeltas (toolCalls, started) {
    for (const tc of toolCalls) {
        const index = tc.index ?? 0;
        if (!started.has(index) && (tc.id || (tc.function && tc.function.name))) {
            started.add(index);
            yield { type: 'tool_use_start', index, id: tc.id, name: tc.function && tc.function.name };
        }
        if (tc.function && tc.function.arguments) {
            yield { type: 'tool_use_delta', index, partial_json: tc.function.arguments };
        }
    }
}

function *mapChoice (choice, started) {
    const delta = choice.delta || {};
    if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
    }
    if (Array.isArray(delta.tool_calls)) {
        yield* mapToolCallDeltas(delta.tool_calls, started);
    }
    if (choice.finish_reason) {
        yield { type: 'message_delta', stop_reason: mapFinishReason(choice.finish_reason) };
    }
}

export async function *mapOpenAiStream (raw) {
    yield { type: 'message_start' };

    const started = new Set();

    for await (const chunk of raw) {
        const choice = chunk.choices && chunk.choices[0];
        if (choice) {
            yield* mapChoice(choice, started);
        }
    }

    yield { type: 'message_stop' };
}

/**
 * Builds OpenAI request params from a normalized request and streams the
 * normalized events.
 * @param {Object} client An `openai` client
 * @param {Object} args { model, normalizedRequest, signal }
 * @returns {AsyncGenerator}
 */
export async function *streamOpenAi (client, { model, normalizedRequest, signal }) {
    const params = {
        model,
        messages: toOpenAiMessages(normalizedRequest),
        max_tokens: normalizedRequest.max_tokens || 8192,
        stream: true
    };

    const tools = toOpenAiTools(normalizedRequest.tools || []);
    if (tools.length > 0) {
        params.tools = tools;
    }

    const raw = await client.chat.completions.create(params, { signal });
    yield* mapOpenAiStream(raw);
}

export default { toOpenAiMessages, toOpenAiTools, mapOpenAiStream, streamOpenAi };
