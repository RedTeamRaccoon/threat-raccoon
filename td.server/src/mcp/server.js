/**
 * @name server
 * @description Builds an MCP server that exposes the shared/tmcore operations as
 * MCP tools. Each tool handler: loadModel -> ops.fn(model, args) -> saveModel
 * (mutating ops only) -> result. The model store is injected so the same server
 * works over the repo-backed (HTTP) store and a file-backed (stdio) store.
 */
import {
    CallToolRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { loadTmcore } from './loadTmcore.js';

// Read-only ops never persist — avoids spurious commits/writes on inspection.
export const READONLY_OPS = new Set(['listThreats', 'validateModel', 'getModelSummary']);

// Listed only when a getEditorContext dependency is wired in (HTTP/stdio entry).
export const EDITOR_CONTEXT_TOOL = {
    name: 'getEditorContext',
    description: 'Reports which threat model / diagram the user currently has open in the ' +
        'Threat Dragon editor, so "the diagram I am working on" can be resolved without asking. ' +
        'The result includes an `updatedAt` ISO timestamp — treat stale timestamps with caution, ' +
        'the user may have moved on since. Returns `{ context: null }` when nothing has been ' +
        'reported; in that case call getModelSummary and ask the user which diagram they mean.',
    input_schema: { type: 'object', properties: {} }
};

// Reusable prompt templates the client surfaces to the user (e.g. slash-commands).
export const PROMPT_DEFS = [
    {
        name: 'build_threat_model',
        description: 'Build a complete, readable threat model (DFD + thorough STRIDE threats) from a system description.',
        arguments: [{ name: 'system_description', description: 'A description of the system, or a pasted design document.', required: false }]
    },
    {
        name: 'review_coverage',
        description: 'Review the current model and fix gaps in threat coverage, flow naming and layout readability.',
        arguments: []
    }
];

/**
 * @returns {Function} ListPrompts handler
 */
export const makeListPromptsHandler = () => () => ({ prompts: PROMPT_DEFS });

/**
 * @param {Object} tmcore the loaded shared/tmcore module (for the prompt task builders)
 * @returns {Function} GetPrompt handler
 */
export const makeGetPromptHandler = (tmcore) => (request) => {
    const { name, arguments: args } = request.params;
    let text;
    if (name === 'build_threat_model') {
        text = tmcore.buildModelTask((args && args.system_description) || '');
    } else if (name === 'review_coverage') {
        text = tmcore.reviewCoverageTask();
    } else {
        throw new Error(`Unknown prompt: ${name}`);
    }
    return { messages: [{ role: 'user', content: { type: 'text', text } }] };
};

/**
 * @param {Object[]} toolDefinitions tmcore tool definitions ({name, description, input_schema})
 * @param {Function} [getEditorContext] when provided, getEditorContext is also listed
 * @returns {Function} ListTools handler
 */
export const makeListToolsHandler = (toolDefinitions, getEditorContext) => () => ({
    tools: (toolDefinitions || []).
        concat(getEditorContext ? [EDITOR_CONTEXT_TOOL] : []).
        map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.input_schema
        }))
});

/**
 * @param {Object} deps { ops, modelStore, getEditorContext? }
 * @returns {Function} CallTool handler
 */
export const makeCallToolHandler = ({ ops, modelStore, getEditorContext }) => async (request) => {
    const { name, arguments: args } = request.params;

    // Editor context is server state, not model state: never loads/saves the model.
    if (name === EDITOR_CONTEXT_TOOL.name && getEditorContext) {
        try {
            const context = await getEditorContext();
            return { content: [{ type: 'text', text: JSON.stringify({ context: context || null }) }] };
        } catch (e) {
            return { isError: true, content: [{ type: 'text', text: e.message }] };
        }
    }

    const op = ops[name];

    if (typeof op !== 'function') {
        return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }

    try {
        const model = await modelStore.loadModel();
        // ops are pure: they return a NEW model — persist the RETURNED one.
        const { model: nextModel, result } = op(model, args || {});
        if (!READONLY_OPS.has(name)) {
            await modelStore.saveModel(nextModel);
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
        // TmcoreError carries structured validation details on `.errors`.
        const text = e.errors ? `${e.message}: ${JSON.stringify(e.errors)}` : e.message;
        return { isError: true, content: [{ type: 'text', text }] };
    }
};

/**
 * Creates an MCP server bound to a model store.
 * @param {Object} modelStore { loadModel(): Promise<model>, saveModel(model): Promise<*> }
 * @param {Object} deps optional { tmcore, getEditorContext } injection. tmcore defaults to
 * lazy-loading shared/tmcore; getEditorContext (sync or async, returns context|null), when
 * provided, additionally exposes the getEditorContext tool.
 * @returns {Promise<Server>}
 */
export const createMcpServer = async (modelStore, deps = {}) => {
    const tmcore = deps.tmcore || await loadTmcore();
    const { ops, toolDefinitions, MODELING_GUIDANCE } = tmcore;
    const { getEditorContext } = deps;

    const server = new Server(
        { name: 'threat-dragon', version: '2.6.2' },
        // `instructions` is surfaced to the connecting client so external agents
        // get the same readable-layout / thorough-STRIDE teaching as the in-app
        // assistant, not just the per-tool descriptions.
        { capabilities: { tools: {}, prompts: {} }, instructions: MODELING_GUIDANCE }
    );

    server.setRequestHandler(ListToolsRequestSchema, makeListToolsHandler(toolDefinitions, getEditorContext));
    server.setRequestHandler(CallToolRequestSchema, makeCallToolHandler({ ops, modelStore, getEditorContext }));
    server.setRequestHandler(ListPromptsRequestSchema, makeListPromptsHandler());
    server.setRequestHandler(GetPromptRequestSchema, makeGetPromptHandler(tmcore));

    return server;
};

export default {
    createMcpServer,
    makeListToolsHandler,
    makeCallToolHandler,
    makeListPromptsHandler,
    makeGetPromptHandler,
    PROMPT_DEFS,
    READONLY_OPS,
    EDITOR_CONTEXT_TOOL
};
