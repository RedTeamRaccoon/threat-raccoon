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
    ASSISTANT_SEND,
    ASSISTANT_CLEAR
} from '@/store/actions/assistant.js';
import { runAgentLoop } from '@/service/assistant/agentLoop.js';

const clone = (obj) => JSON.parse(JSON.stringify(obj));

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
    abortRequested: false
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
    [ASSISTANT_SEND]: async ({ commit, state }, { text, binding, signal }) => {
        commit(ASSISTANT_ADD_MESSAGE, { role: 'user', content: [{ type: 'text', text }] });
        commit(ASSISTANT_STREAM_RESET);
        commit(ASSISTANT_TOOL_CLEAR);
        commit(ASSISTANT_SET_ERROR, null);
        commit(ASSISTANT_SET_RUN_STATE, 'running');

        const working = clone(state.messages);
        const attachments = clone(state.attachments);

        try {
            await runAgentLoop({
                binding,
                provider: state.provider,
                model: state.model,
                messages: working,
                attachments,
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
                }
            });
            commit(ASSISTANT_CLEAR_ATTACHMENTS);
        } catch (err) {
            if (!err || err.name !== 'AbortError') {
                commit(ASSISTANT_SET_ERROR, err && err.message ? err.message : String(err));
            }
        } finally {
            commit(ASSISTANT_STREAM_RESET);
            commit(ASSISTANT_TOOL_CLEAR);
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
