/**
 * @name proxyClient
 * @description Streaming transport for the assistant. Reads the normalized SSE
 * events emitted by the server LLM proxy (POST /api/llm/complete). In desktop mode
 * it swaps the HTTP transport for an IPC relay that emits the SAME normalized events
 * (see src/desktop/llm.js), so the agent loop is transport-agnostic.
 *
 * Normalized event types: message_start, text_delta, tool_use_start, tool_use_delta,
 * message_delta, message_stop, error.
 */
import isElectron from 'is-electron';

import storeFactory from '@/store/index.js';

const COMPLETE_URL = '/api/llm/complete';

const authHeaders = () => {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
    };
    const store = storeFactory.get();
    if (store.state.auth && store.state.auth.jwt) {
        headers.Authorization = `Bearer ${store.state.auth.jwt}`;
    }
    return headers;
};

const parseEvent = (raw) => {
    let eventName = 'message';
    const dataLines = [];
    raw.split('\n').forEach((line) => {
        if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
        }
    });
    const dataStr = dataLines.join('\n');
    let payload = {};
    if (dataStr) {
        try {
            payload = JSON.parse(dataStr);
        } catch (e) {
            payload = { raw: dataStr };
        }
    }
    return { type: eventName, ...payload };
};

// Drain complete SSE records (delimited by a blank line) from the buffer,
// dispatching each to dispatch(). Returns the unconsumed tail.
const drainBuffer = (buffer, dispatch) => {
    let idx;
    let rest = buffer;
    while ((idx = rest.indexOf('\n\n')) !== -1) {
        const record = rest.slice(0, idx);
        rest = rest.slice(idx + 2);
        if (record.trim()) {
            dispatch(parseEvent(record));
        }
    }
    return rest;
};

const streamHttp = async (request, { onEvent, signal }) => {
    const res = await fetch(COMPLETE_URL, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(request),
        signal
    });

    if (!res.ok || !res.body) {
        let detail = '';
        try {
            detail = await res.text();
        } catch (e) {
            detail = res.statusText;
        }
        throw new Error(`LLM proxy error ${res.status}: ${detail}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stopped = false;

    const dispatch = (evt) => {
        if (evt.type === 'error') {
            throw new Error(evt.message || 'LLM stream error');
        }
        onEvent(evt);
        if (evt.type === 'message_stop') {
            stopped = true;
        }
    };

    for (;;) {
        const { value, done } = await reader.read();
        if (value) {
            buffer += decoder.decode(value, { stream: true });
            buffer = drainBuffer(buffer, dispatch);
        }
        if (done || stopped) {
            break;
        }
    }
    // flush any trailing record
    drainBuffer(`${buffer}\n\n`, dispatch);
};

const streamDesktop = (request, { onEvent, signal }) => new Promise((resolve, reject) => {
    let cleanup = () => {};

    const handler = (_event, evt) => {
        if (evt.type === 'error') {
            cleanup();
            reject(new Error(evt.message || 'LLM stream error'));
            return;
        }
        onEvent(evt);
        if (evt.type === 'message_stop') {
            cleanup();
            resolve();
        }
    };

    const onAbort = () => {
        window.electronAPI.llmStreamAbort();
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
    };

    const off = window.electronAPI.onLlmStreamEvent(handler);
    cleanup = () => {
        if (typeof off === 'function') {
            off();
        }
        if (signal) {
            signal.removeEventListener('abort', onAbort);
        }
    };

    if (signal) {
        if (signal.aborted) {
            onAbort();
            return;
        }
        signal.addEventListener('abort', onAbort);
    }

    window.electronAPI.llmStreamStart(request);
});

/**
 * Stream a normalized completion. Resolves when the stream ends (message_stop),
 * rejects on an error event, transport failure or abort.
 * @param {object} request normalized request { provider, model, system, messages, tools, stream }
 * @param {{ onEvent: Function, signal?: AbortSignal }} handlers
 * @returns {Promise<void>}
 */
const streamCompletion = (request, handlers) => {
    if (isElectron() && window.electronAPI && window.electronAPI.llmStreamStart) {
        return streamDesktop(request, handlers);
    }
    return streamHttp(request, handlers);
};

export default { streamCompletion };
export { streamCompletion };
