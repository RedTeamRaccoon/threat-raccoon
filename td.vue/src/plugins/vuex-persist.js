import VuexPersistence from 'vuex-persist';

// Any persisted conversation text block longer than this is treated as bulky raw
// document content and stubbed out before it reaches sessionStorage. Normal chat
// prose never approaches it; this is purely a safety net against the ~5MB quota.
const BULKY_BLOCK_THRESHOLD = 50000;

/**
 * Produce a sessionStorage-safe copy of a conversation message.
 *
 * Store messages should only ever contain text / tool_use / tool_result blocks
 * (attachments and chunked-document sections are merged into the OUTGOING request
 * inside the agent loop, against a local copy, and are never committed to the
 * store). This sanitiser is a defensive belt-and-braces measure: it drops any
 * image blocks and stubs over-long text blocks so a stray bulky block can never
 * blow the sessionStorage quota.
 * @param {Object} message
 * @returns {Object}
 */
const sanitizeMessage = (message) => {
    if (!message || !Array.isArray(message.content)) {
        return message;
    }
    const content = [];
    for (const block of message.content) {
        if (block && block.type === 'image') {
            // base64 page images (PDF ingestion) must never be persisted
            content.push({ type: 'text', text: '[image omitted]' });
            continue;
        }
        if (block && block.type === 'text' && typeof block.text === 'string'
            && block.text.length > BULKY_BLOCK_THRESHOLD) {
            content.push({ type: 'text', text: '[large document text omitted]' });
            continue;
        }
        content.push(block);
    }
    return { ...message, content };
};

/**
 * Slim the assistant module down to the durable conversation state so the chat
 * survives navigation and full page loads (until the user clears it). Volatile
 * run-state is explicitly reset to its initial values so the restored object is
 * the full module shape — merging cleanly over the module's initialState rather
 * than leaving volatile keys undefined.
 * @param {Object} assistant the live assistant module state
 * @returns {Object} the persisted assistant shape
 */
export const reduceAssistant = (assistant) => {
    if (!assistant) {
        return assistant;
    }
    const messages = Array.isArray(assistant.messages)
        ? assistant.messages.map(sanitizeMessage)
        : [];
    return {
        // durable: the chat the user expects to find again
        panelOpen: !!assistant.panelOpen,
        provider: assistant.provider || null,
        model: assistant.model || null,
        messages,
        // durable: the user's chosen step budget survives navigation/reloads.
        // Coerced to a number with a sensible default so a corrupt stored value
        // can never restore as NaN/undefined.
        maxSteps: Number.isFinite(Number(assistant.maxSteps)) ? Number(assistant.maxSteps) : 50,
        // volatile run-state — reset to initial values on restore. Attachments
        // can carry multi-MB base64 page images, so they are never persisted.
        attachments: [],
        streaming: false,
        streamingText: '',
        pendingToolCalls: [],
        runState: 'idle',
        error: null,
        abortRequested: false,
        sectionProgress: null,
        // volatile: the step-limit notice is per-run, never persisted
        stepLimitReached: null
    };
};

export const reducer = (state) => ({
    ...state,
    assistant: reduceAssistant(state.assistant)
});

const session = new VuexPersistence({
    key: 'td.vuex',
    storage: window.sessionStorage,
    // Persist a SLIMMED assistant module: the durable chat (panelOpen, provider,
    // model, messages) survives navigation and page reloads, while volatile
    // run-state and bulky attachments are dropped / reset. Everything else is
    // persisted unchanged.
    reducer
});

export default {
    session
};
