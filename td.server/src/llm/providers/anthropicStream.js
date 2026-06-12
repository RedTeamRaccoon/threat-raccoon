/**
 * @name anthropicStream
 * @description Maps the Anthropic streaming wire format onto Threat Dragon's
 * normalized SSE event shape. Shared by the `anthropic` and `claudecode`
 * adapters (both speak the Anthropic wire format; only auth differs).
 *
 * Normalized events emitted: message_start, text_delta, tool_use_start,
 * tool_use_delta, message_delta, message_stop, error.
 */

/**
 * Translates a raw Anthropic stream (async iterable of SDK events) into
 * normalized events.
 * @param {AsyncIterable} raw
 * @returns {AsyncGenerator}
 */
export async function *mapAnthropicStream (raw) {
    for await (const event of raw) {
        switch (event.type) {
        case 'message_start':
            yield { type: 'message_start' };
            break;
        case 'content_block_start':
            if (event.content_block && event.content_block.type === 'tool_use') {
                yield {
                    type: 'tool_use_start',
                    index: event.index,
                    id: event.content_block.id,
                    name: event.content_block.name
                };
            }
            break;
        case 'content_block_delta':
            if (event.delta && event.delta.type === 'text_delta') {
                yield { type: 'text_delta', text: event.delta.text };
            } else if (event.delta && event.delta.type === 'input_json_delta') {
                yield { type: 'tool_use_delta', index: event.index, partial_json: event.delta.partial_json };
            }
            break;
        case 'message_delta':
            if (event.delta && event.delta.stop_reason) {
                yield { type: 'message_delta', stop_reason: event.delta.stop_reason };
            }
            break;
        case 'message_stop':
            yield { type: 'message_stop' };
            break;
        case 'error': {
            const err = event.error || { message: 'stream error' };
            yield { type: 'error', message: err.message || 'stream error', error: err };
            break;
        }
        default:
            break;
        }
    }
}

// 16384 is the safe ceiling across all current Claude models (thinking tokens
// count toward max_tokens; adaptive thinking does not require a separate budget).
const DEFAULT_MAX_TOKENS = 16384;

/**
 * Builds Anthropic request params from a normalized request and streams the
 * normalized events. Defaults to adaptive thinking per the Opus 4.8 conventions
 * (adaptive thinking only; no temperature / budget_tokens).
 * @param {Object} client An @anthropic-ai/sdk client
 * @param {Object} args { model, normalizedRequest, signal }
 * @returns {AsyncGenerator}
 */
export async function *streamAnthropic (client, { model, normalizedRequest, signal }) {
    const params = {
        model,
        max_tokens: normalizedRequest.max_tokens || DEFAULT_MAX_TOKENS,
        messages: normalizedRequest.messages || [],
        stream: true
    };

    if (normalizedRequest.system) {
        params.system = normalizedRequest.system;
    }
    if (Array.isArray(normalizedRequest.tools) && normalizedRequest.tools.length > 0) {
        params.tools = normalizedRequest.tools;
    }
    // Opus 4.8: adaptive thinking is the only on-mode. Callers may override.
    params.thinking = normalizedRequest.thinking || { type: 'adaptive' };

    const raw = client.messages.stream(params, { signal });
    yield* mapAnthropicStream(raw);
}

export default { mapAnthropicStream, streamAnthropic };
