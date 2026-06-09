/**
 * @name llm (desktop relay)
 * @description Desktop-mode LLM relay implementing the SAME normalized streaming
 * contract as the server-side adapters, so the browser proxyClient can stream over an
 * IPC channel with no backend. Bring-your-own-key: the key is read from the encrypted
 * desktop keyStore.
 *
 * Normalized request: { provider, model, system, messages, tools, stream }
 * Normalized events out: message_start, text_delta, tool_use_start, tool_use_delta,
 * message_delta, message_stop, error  (Anthropic content-block superset).
 *
 * Adapters mirror the server adapters:
 *  - anthropic   : Anthropic Messages API, x-api-key
 *  - claudecode  : Anthropic wire format, OAuth bearer + anthropic-beta header (no x-api-key)
 *  - openai      : OpenAI-compatible chat-completions
 *  - copilot     : OpenAI-compatible chat-completions against the Copilot endpoint
 */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const COPILOT_URL = 'https://api.githubcopilot.com/chat/completions';
const DEFAULT_MAX_TOKENS = 4096;

const parseSseRecord = (record) => {
    const dataLines = [];
    record.split('\n').forEach((line) => {
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
        }
    });
    const dataStr = dataLines.join('\n');
    if (!dataStr || dataStr === '[DONE]') {
        return dataStr === '[DONE]' ? '[DONE]' : null;
    }
    try {
        return JSON.parse(dataStr);
    } catch (e) {
        return null;
    }
};

// Read an SSE body to completion, invoking handle(parsed) for each record.
const readSse = async (res, handle, onEvent) => {
    if (!res.ok || !res.body) {
        let detail = '';
        try {
            detail = await res.text();
        } catch (e) {
            detail = res.statusText;
        }
        onEvent({ type: 'error', message: `Provider error ${res.status}: ${detail}` });
        return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const drain = () => {
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const record = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (record.trim()) {
                handle(parseSseRecord(record));
            }
        }
    };
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { value, done } = await reader.read();
        if (value) {
            buffer += decoder.decode(value, { stream: true });
            drain();
        }
        if (done) {
            break;
        }
    }
};

// ---- Anthropic family (anthropic, claudecode) ----

const normalizeAnthropic = (evt) => {
    if (!evt || evt === '[DONE]') {
        return null;
    }
    switch (evt.type) {
    case 'message_start':
        return { type: 'message_start' };
    case 'content_block_start':
        if (evt.content_block && evt.content_block.type === 'tool_use') {
            return { type: 'tool_use_start', id: evt.content_block.id, name: evt.content_block.name };
        }
        return null;
    case 'content_block_delta':
        if (evt.delta && evt.delta.type === 'text_delta') {
            return { type: 'text_delta', text: evt.delta.text };
        }
        if (evt.delta && evt.delta.type === 'input_json_delta') {
            return { type: 'tool_use_delta', partial_json: evt.delta.partial_json };
        }
        return null;
    case 'message_delta':
        return { type: 'message_delta', stop_reason: evt.delta && evt.delta.stop_reason };
    case 'message_stop':
        return { type: 'message_stop' };
    case 'error':
        return { type: 'error', message: (evt.error && evt.error.message) || 'Provider error' };
    default:
        return null;
    }
};

const streamAnthropic = async ({ url = ANTHROPIC_URL, headers, request, fetchImpl, onEvent, signal }) => {
    const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
            model: request.model,
            max_tokens: request.max_tokens || DEFAULT_MAX_TOKENS,
            system: request.system,
            messages: request.messages,
            tools: request.tools,
            stream: true
        }),
        signal
    });
    await readSse(res, (parsed) => {
        const normalized = normalizeAnthropic(parsed);
        if (normalized) {
            onEvent(normalized);
        }
    }, onEvent);
};

// ---- OpenAI-compatible family (openai, copilot) ----

// Translate normalized (Anthropic-superset) messages into OpenAI chat messages.
export const toOpenAiMessages = (request) => {
    const out = [];
    if (request.system) {
        out.push({ role: 'system', content: request.system });
    }
    (request.messages || []).forEach((message) => {
        const blocks = Array.isArray(message.content)
            ? message.content
            : [{ type: 'text', text: String(message.content) }];

        if (message.role === 'assistant') {
            const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
            const toolCalls = blocks
                .filter((b) => b.type === 'tool_use')
                .map((b) => ({
                    id: b.id,
                    type: 'function',
                    function: { name: b.name, arguments: JSON.stringify(b.input || {}) }
                }));
            const msg = { role: 'assistant', content: text || null };
            if (toolCalls.length) {
                msg.tool_calls = toolCalls;
            }
            out.push(msg);
            return;
        }

        // user role
        blocks.filter((b) => b.type === 'tool_result').forEach((tr) => {
            out.push({
                role: 'tool',
                tool_call_id: tr.tool_use_id,
                content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content)
            });
        });
        const others = blocks.filter((b) => b.type !== 'tool_result');
        if (!others.length) {
            return;
        }
        if (others.some((b) => b.type === 'image')) {
            out.push({
                role: 'user',
                content: others.map((b) => (b.type === 'image'
                    ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
                    : { type: 'text', text: b.text }))
            });
        } else {
            out.push({ role: 'user', content: others.map((b) => b.text).join('') });
        }
    });
    return out;
};

export const toOpenAiTools = (tools) => (tools || []).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema }
}));

const OPENAI_STOP_REASON = { tool_calls: 'tool_use', stop: 'end_turn', length: 'max_tokens' };

const streamOpenAiCompatible = async ({ url, headers, apiKey, request, fetchImpl, onEvent, signal }) => {
    const body = {
        model: request.model,
        messages: toOpenAiMessages(request),
        stream: true
    };
    const tools = toOpenAiTools(request.tools);
    if (tools.length) {
        body.tools = tools;
    }

    const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...headers },
        body: JSON.stringify(body),
        signal
    });

    const started = {};
    let stopped = false;

    await readSse(res, (parsed) => {
        if (parsed === '[DONE]') {
            if (!stopped) {
                onEvent({ type: 'message_stop' });
                stopped = true;
            }
            return;
        }
        if (!parsed || !parsed.choices || !parsed.choices.length) {
            return;
        }
        const choice = parsed.choices[0];
        const delta = choice.delta || {};
        if (delta.content) {
            onEvent({ type: 'text_delta', text: delta.content });
        }
        (delta.tool_calls || []).forEach((tc) => {
            const idx = tc.index != null ? tc.index : 0;
            if (!started[idx] && tc.id && tc.function && tc.function.name) {
                started[idx] = true;
                onEvent({ type: 'tool_use_start', id: tc.id, name: tc.function.name });
            }
            if (tc.function && tc.function.arguments) {
                onEvent({ type: 'tool_use_delta', partial_json: tc.function.arguments });
            }
        });
        if (choice.finish_reason) {
            onEvent({ type: 'message_delta', stop_reason: OPENAI_STOP_REASON[choice.finish_reason] || choice.finish_reason });
        }
    }, onEvent);

    if (!stopped) {
        onEvent({ type: 'message_stop' });
    }
};

/**
 * Build a desktop LLM relay.
 * @param {object} deps
 * @param {(provider:string)=>string|null} deps.getKey resolve the stored API key
 * @param {Function} [deps.fetchImpl] fetch implementation (defaults to global fetch)
 */
export const createLlmRelay = ({ getKey, fetchImpl = fetch }) => ({
    /**
     * Stream a normalized completion, invoking onEvent for each normalized event.
     * Always terminates with a message_stop or an error event.
     */
    async streamCompletion(request, onEvent, signal) {
        try {
            const provider = request.provider || 'anthropic';
            const apiKey = getKey(provider);
            if (!apiKey) {
                onEvent({ type: 'error', message: `No API key configured for ${provider}` });
                return;
            }

            switch (provider) {
            case 'anthropic':
                await streamAnthropic({
                    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
                    request, fetchImpl, onEvent, signal
                });
                return;
            case 'claudecode':
                // OAuth: bearer authToken + beta header, never x-api-key
                await streamAnthropic({
                    headers: {
                        authorization: `Bearer ${apiKey}`,
                        'anthropic-version': ANTHROPIC_VERSION,
                        'anthropic-beta': ANTHROPIC_OAUTH_BETA
                    },
                    request, fetchImpl, onEvent, signal
                });
                return;
            case 'openai':
                await streamOpenAiCompatible({ url: OPENAI_URL, apiKey, request, fetchImpl, onEvent, signal });
                return;
            case 'copilot':
                // OpenAI-compatible wire against the Copilot endpoint. Note: a raw GitHub
                // token may need exchange for a short-lived Copilot bearer; that exchange
                // is a future enhancement — the stored key is sent as-is for now.
                await streamOpenAiCompatible({
                    url: COPILOT_URL,
                    apiKey,
                    headers: { 'editor-version': 'ThreatDragon/1.0', 'copilot-integration-id': 'vscode-chat' },
                    request, fetchImpl, onEvent, signal
                });
                return;
            default:
                onEvent({ type: 'error', message: `Provider "${provider}" is not supported in desktop mode` });
            }
        } catch (err) {
            onEvent({ type: 'error', message: err && err.message ? err.message : String(err) });
        }
    }
});

export default { createLlmRelay, toOpenAiMessages, toOpenAiTools };
