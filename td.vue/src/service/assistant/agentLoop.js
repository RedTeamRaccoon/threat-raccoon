/**
 * @name agentLoop
 * @description Provider-agnostic tool-use loop for the in-app assistant. Assembles
 * the system prompt (threat-modeling instructions + a live model summary) and tool
 * definitions, streams an assistant turn from the proxy, executes any tool_use blocks
 * against the live-canvas binding, posts tool_result blocks back, and repeats until the
 * model stops without requesting tools. Stoppable via an AbortController.
 *
 * Messages use the normalized Anthropic-superset content-block shape:
 *   { role, content: [ { type:'text'|'tool_use'|'tool_result'|'image', ... } ] }
 */
// Import the PURE tool-schema subpath only. tools.js has zero imports (no node
// builtins / import.meta), so it is browser- and jest-safe; the @tmcore barrel and
// validate.js are NOT (they pull node:module) and must never enter the browser bundle.
import { toolDefinitions } from '@tmcore/tools.js';
// guidance.js is pure strings (no node builtins / import.meta), so it is browser-
// and jest-safe like tools.js — the single source for the modeling guidance shared
// with the MCP server.
import { MODELING_GUIDANCE } from '@tmcore/guidance.js';

import proxyClient from '@/service/assistant/proxyClient.js';

const MAX_ITERATIONS = 25;

const SYSTEM_PROMPT = [
    'You are a threat-modeling assistant embedded in OWASP Threat Dragon. You build the model on the live diagram canvas by calling the provided tools, and the user watches it appear in real time. Prefer calling tools to make changes rather than only describing them.',
    'Reply in the language the user writes in. Attached documents may be written in a different language (for example Chinese design documents); read them in their original language, but keep diagram element names and threat titles in the language the user is conversing in unless asked otherwise.',
    MODELING_GUIDANCE
].join('\n\n');

// Extra system-prompt context for the threat model OVERVIEW page (model mode),
// where the assistant operates on the whole model rather than one live canvas.
const MODEL_MODE_CONTEXT = [
    'The user is currently on the threat model OVERVIEW page, which shows a tile for every diagram in the model — they are NOT inside a diagram editor.',
    'You operate on the WHOLE threat model. Call getModelSummary first to list the diagrams and their ids.',
    'Tools that work inside a diagram require a diagramId argument. createDiagram adds a new data-flow diagram to the model.',
    'Changes do not animate on this page — the user opens a diagram to see them.',
    'This mode is well suited to bulk work across multiple diagrams (for example creating several diagrams, or adding threats throughout the model).'
].join(' ');

const stripDataUrl = (data) => (typeof data === 'string' && data.includes(',') ? data.slice(data.indexOf(',') + 1) : data);

// Convert neutral UI attachments to normalized content blocks (Anthropic superset).
const attachmentBlocks = (attachments = []) => attachments.map((a) => {
    if (a.kind === 'image') {
        return {
            type: 'image',
            source: { type: 'base64', media_type: a.mediaType, data: stripDataUrl(a.data) }
        };
    }
    return { type: 'text', text: `Attached document "${a.name || 'untitled'}":\n\n${a.data}` };
});

// Merge attachments into the most recent user message's content.
const mergeAttachments = (messages, attachments) => {
    if (!attachments || !attachments.length) {
        return;
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user') {
            const content = Array.isArray(messages[i].content)
                ? messages[i].content
                : [{ type: 'text', text: String(messages[i].content) }];
            messages[i] = { role: 'user', content: [...attachmentBlocks(attachments), ...content] };
            return;
        }
    }
};

const toWire = (messages) => messages.map((m) => ({
    role: m.role,
    content: Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]
}));

const safeParse = (json) => {
    if (!json) {
        return {};
    }
    try {
        return JSON.parse(json);
    } catch (e) {
        return {};
    }
};

/**
 * Run the agent loop to completion (or until aborted).
 *
 * @param {object} options
 * @param {{ execute: Function }} options.binding live-canvas binding
 * @param {string} options.provider provider id
 * @param {string} options.model model id
 * @param {Array} options.messages conversation so far (mutated/extended in place)
 * @param {Array} [options.attachments] neutral attachments to merge into the last user turn
 * @param {string} [options.systemContext] extra context appended to the system prompt (e.g. MODEL_MODE_CONTEXT)
 * @param {Array} [options.tools] tool definitions (defaults to @tmcore/tools.js toolDefinitions)
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.proxy] transport (defaults to proxyClient), for testing
 * @param {object} [options.callbacks] UI hooks
 * @returns {Promise<Array>} the extended messages array
 */
const runAgentLoop = async (options) => {
    const {
        binding,
        provider,
        model,
        messages,
        attachments = [],
        systemContext = null,
        signal,
        tools = toolDefinitions,
        proxy = proxyClient,
        callbacks = {}
    } = options;

    mergeAttachments(messages, attachments);

    const buildSystem = async () => {
        const base = systemContext ? `${SYSTEM_PROMPT}\n\n${systemContext}` : SYSTEM_PROMPT;
        const summaryRes = await binding.execute('getModelSummary');
        const summary = summaryRes && summaryRes.ok ? summaryRes.result : null;
        if (!summary) {
            return base;
        }
        return `${base}\n\nCurrent model summary (JSON):\n${JSON.stringify(summary)}`;
    };

    const consumeStream = async (request) => {
        let text = '';
        const collected = [];

        await proxy.streamCompletion(request, {
            signal,
            onEvent: (evt) => {
                switch (evt.type) {
                case 'text_delta':
                    text += evt.text || '';
                    if (callbacks.onText) {
                        callbacks.onText(evt.text || '');
                    }
                    break;
                case 'tool_use_start':
                    collected.push({ id: evt.id, name: evt.name, inputJson: '' });
                    if (callbacks.onToolUseStart) {
                        callbacks.onToolUseStart({ id: evt.id, name: evt.name });
                    }
                    break;
                case 'tool_use_delta': {
                    const current = collected[collected.length - 1];
                    if (current) {
                        current.inputJson += evt.partial_json || '';
                    }
                    break;
                }
                default:
                    break;
                }
            }
        });

        const toolUses = collected.map((t) => ({
            type: 'tool_use',
            id: t.id,
            name: t.name,
            input: safeParse(t.inputJson)
        }));
        const content = [];
        if (text) {
            content.push({ type: 'text', text });
        }
        content.push(...toolUses);
        return { content, toolUses };
    };

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
        if (signal && signal.aborted) {
            break;
        }

        const request = {
            provider,
            model,
            system: await buildSystem(),
            messages: toWire(messages),
            tools,
            stream: true
        };

        const { content, toolUses } = await consumeStream(request);
        const assistantMessage = { role: 'assistant', content };
        messages.push(assistantMessage);
        if (callbacks.onTurnComplete) {
            callbacks.onTurnComplete(assistantMessage);
        }

        if (!toolUses.length) {
            break;
        }

        const results = [];
        for (const toolUse of toolUses) {
            if (signal && signal.aborted) {
                break;
            }
            // eslint-disable-next-line no-await-in-loop
            const res = await binding.execute(toolUse.name, toolUse.input);
            results.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: res.ok ? JSON.stringify(res.result) : (res.error || 'Operation failed'),
                is_error: !res.ok
            });
            if (callbacks.onToolResult) {
                callbacks.onToolResult({
                    id: toolUse.id,
                    name: toolUse.name,
                    ok: res.ok,
                    result: res.result,
                    error: res.error
                });
            }
        }
        const resultsMessage = { role: 'user', content: results };
        messages.push(resultsMessage);
        if (callbacks.onToolResults) {
            callbacks.onToolResults(resultsMessage);
        }
    }

    return messages;
};

export default { runAgentLoop };
export { runAgentLoop, MODEL_MODE_CONTEXT };
