import Vue from 'vue';

import {
    ASSISTANT_SET_PANEL,
    ASSISTANT_TOGGLE_PANEL,
    ASSISTANT_SET_PROVIDER,
    ASSISTANT_SET_MODEL,
    ASSISTANT_ADD_ATTACHMENT,
    ASSISTANT_REMOVE_ATTACHMENT,
    ASSISTANT_CLEAR_ATTACHMENTS,
    ASSISTANT_ADD_MESSAGE,
    ASSISTANT_STREAM_TEXT,
    ASSISTANT_STREAM_RESET,
    ASSISTANT_TOOL_START,
    ASSISTANT_TOOL_RESULT,
    ASSISTANT_TOOL_CLEAR,
    ASSISTANT_SET_RUN_STATE,
    ASSISTANT_SET_ERROR,
    ASSISTANT_SECTION_PROGRESS,
    ASSISTANT_SEND,
    ASSISTANT_CLEAR
} from '@/store/actions/assistant.js';
import { runAgentLoop } from '@/service/assistant/agentLoop.js';

const clone = (obj) => JSON.parse(JSON.stringify(obj));

// any conversation text block longer than this is a raw document section (user
// prose never gets near it) — the only thing worth pruning once incorporated
const BULKY_BLOCK_THRESHOLD = 50000;

/**
 * Replaces the bulky raw text of an already-ingested document section with a
 * short omission stub, so the conversation stays bounded while the threat model
 * itself (re-injected into every request's system prompt) carries the memory.
 * Section 1 rides in the attachment block (starts with `Attached document`),
 * later sections in the continuation messages ASSISTANT_SEND pushes — either
 * way it is the only user text block longer than the bulky threshold.
 * @param {Array} messages conversation (mutated in place)
 * @param {{ index: Number, total: Number, name: String }} section the section just ingested
 * @returns {Boolean} true when a block was pruned
 */
export const pruneIngestedSection = (messages, { index, total, name }) => {
    for (const message of messages) {
        if (message.role !== 'user' || !Array.isArray(message.content)) {
            continue;
        }
        for (const block of message.content) {
            if (block.type === 'text' && typeof block.text === 'string'
                && block.text.length > BULKY_BLOCK_THRESHOLD) {
                block.text = `[Section ${index}/${total} of "${name}" omitted - already incorporated into the threat model.]`;
                return true;
            }
        }
    }
    return false;
};

const initialState = () => ({
    panelOpen: false,
    provider: null,
    model: null,
    messages: [],
    streaming: false,
    streamingText: '',
    pendingToolCalls: [],
    runState: 'idle',
    attachments: [],
    error: null,
    abortRequested: false,
    // { current, total, name } while a chunked document section is being fed
    // to the agent; null otherwise
    sectionProgress: null
});

const state = initialState();

const actions = {
    [ASSISTANT_SET_PANEL]: ({ commit }, open) => commit(ASSISTANT_SET_PANEL, open),
    [ASSISTANT_TOGGLE_PANEL]: ({ commit }) => commit(ASSISTANT_TOGGLE_PANEL),
    [ASSISTANT_SET_PROVIDER]: ({ commit }, provider) => commit(ASSISTANT_SET_PROVIDER, provider),
    [ASSISTANT_SET_MODEL]: ({ commit }, model) => commit(ASSISTANT_SET_MODEL, model),
    [ASSISTANT_ADD_ATTACHMENT]: ({ commit }, attachment) => commit(ASSISTANT_ADD_ATTACHMENT, attachment),
    [ASSISTANT_REMOVE_ATTACHMENT]: ({ commit }, index) => commit(ASSISTANT_REMOVE_ATTACHMENT, index),
    [ASSISTANT_CLEAR_ATTACHMENTS]: ({ commit }) => commit(ASSISTANT_CLEAR_ATTACHMENTS),
    [ASSISTANT_CLEAR]: ({ commit }) => commit(ASSISTANT_CLEAR),

    /**
     * Send a user message and run the agent loop to completion against the live
     * canvas binding. The binding + abort signal are supplied by the panel component
     * (they hold non-serializable references that must not live in store state).
     */
    [ASSISTANT_SEND]: async ({ commit, state }, { text, binding, signal, systemContext }) => {
        commit(ASSISTANT_ADD_MESSAGE, { role: 'user', content: [{ type: 'text', text }] });
        commit(ASSISTANT_STREAM_RESET);
        commit(ASSISTANT_TOOL_CLEAR);
        commit(ASSISTANT_SET_ERROR, null);
        commit(ASSISTANT_SET_RUN_STATE, 'running');

        const working = clone(state.messages);
        const attachments = clone(state.attachments);
        // sections 2..N of chunked documents (long PDFs): fed to the agent one
        // at a time AFTER the previous run completed, because the agent's
        // updated model summary (re-injected into every request's system
        // prompt) is the memory that carries continuity between sections
        const pendingSections = attachments.flatMap((a) =>
            (a.pendingSections || []).map((s) => ({ ...s, name: a.name || 'document' })));

        const runLoop = (extra) => runAgentLoop({
            binding,
            provider: state.provider,
            model: state.model,
            messages: working,
            systemContext,
            signal,
            callbacks: {
                onText: (delta) => commit(ASSISTANT_STREAM_TEXT, delta),
                onToolUseStart: (call) => commit(ASSISTANT_TOOL_START, call),
                onToolResult: (result) => commit(ASSISTANT_TOOL_RESULT, result),
                onTurnComplete: (message) => {
                    commit(ASSISTANT_ADD_MESSAGE, message);
                    commit(ASSISTANT_STREAM_RESET);
                },
                onToolResults: (message) => commit(ASSISTANT_ADD_MESSAGE, message)
            },
            ...extra
        });

        try {
            await runLoop({ attachments });
            commit(ASSISTANT_CLEAR_ATTACHMENTS);
            for (const section of pendingSections) {
                if ((signal && signal.aborted) || state.error) {
                    break;
                }
                // the previous section is in the model now: drop its raw text
                // from the conversation so context stays bounded
                pruneIngestedSection(working, {
                    index: section.index - 1,
                    total: section.total,
                    name: section.name
                });
                working.push({
                    role: 'user',
                    content: [{
                        type: 'text',
                        text: `Continuing the attached document "${section.name}" - section ${section.index}/${section.total}`
                            + ` (pages ${section.pageRange}):\n\n${section.text}\n\nIncorporate this section into the`
                            + ' threat model the same way; the current model state is in your system prompt.'
                    }]
                });
                commit(ASSISTANT_SECTION_PROGRESS, {
                    current: section.index,
                    total: section.total,
                    name: section.name
                });
                // eslint-disable-next-line no-await-in-loop
                await runLoop({});
            }
        } catch (err) {
            if (!err || err.name !== 'AbortError') {
                commit(ASSISTANT_SET_ERROR, err && err.message ? err.message : String(err));
            }
        } finally {
            commit(ASSISTANT_STREAM_RESET);
            commit(ASSISTANT_TOOL_CLEAR);
            commit(ASSISTANT_SECTION_PROGRESS, null);
            commit(ASSISTANT_SET_RUN_STATE, 'idle');
        }
    }
};

const mutations = {
    [ASSISTANT_SET_PANEL]: (state, open) => {
        state.panelOpen = !!open;
    },
    [ASSISTANT_TOGGLE_PANEL]: (state) => {
        state.panelOpen = !state.panelOpen;
    },
    [ASSISTANT_SET_PROVIDER]: (state, provider) => {
        state.provider = provider;
    },
    [ASSISTANT_SET_MODEL]: (state, model) => {
        state.model = model;
    },
    [ASSISTANT_ADD_ATTACHMENT]: (state, attachment) => {
        Vue.set(state.attachments, state.attachments.length, attachment);
    },
    [ASSISTANT_REMOVE_ATTACHMENT]: (state, index) => {
        state.attachments.splice(index, 1);
    },
    [ASSISTANT_CLEAR_ATTACHMENTS]: (state) => {
        state.attachments.splice(0);
    },
    [ASSISTANT_ADD_MESSAGE]: (state, message) => {
        Vue.set(state.messages, state.messages.length, message);
    },
    [ASSISTANT_STREAM_TEXT]: (state, delta) => {
        state.streaming = true;
        state.streamingText += delta;
    },
    [ASSISTANT_STREAM_RESET]: (state) => {
        state.streaming = false;
        state.streamingText = '';
    },
    [ASSISTANT_TOOL_START]: (state, call) => {
        Vue.set(state.pendingToolCalls, state.pendingToolCalls.length, {
            id: call.id,
            name: call.name,
            status: 'running'
        });
    },
    [ASSISTANT_TOOL_RESULT]: (state, result) => {
        const idx = state.pendingToolCalls.findIndex((c) => c.id === result.id);
        if (idx >= 0) {
            Vue.set(state.pendingToolCalls, idx, {
                ...state.pendingToolCalls[idx],
                status: result.ok ? 'ok' : 'error',
                error: result.error || null
            });
        }
    },
    [ASSISTANT_TOOL_CLEAR]: (state) => {
        state.pendingToolCalls.splice(0);
    },
    [ASSISTANT_SET_RUN_STATE]: (state, runState) => {
        state.runState = runState;
        state.abortRequested = false;
    },
    [ASSISTANT_SET_ERROR]: (state, error) => {
        state.error = error;
    },
    [ASSISTANT_SECTION_PROGRESS]: (state, progress) => {
        state.sectionProgress = progress;
    },
    [ASSISTANT_CLEAR]: (state) => {
        Object.assign(state, initialState());
    }
};

const getters = {
    assistantBusy: (state) => state.runState === 'running'
};

export default {
    state,
    actions,
    mutations,
    getters
};
