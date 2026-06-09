/**
 * @name server
 * @description Builds an MCP server that exposes the shared/tmcore operations as
 * MCP tools. Each tool handler: loadModel -> ops.fn(model, args) -> saveModel
 * (mutating ops only) -> result. The model store is injected so the same server
 * works over the repo-backed (HTTP) store and a file-backed (stdio) store.
 */
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { loadTmcore } from './loadTmcore.js';

// Read-only ops never persist — avoids spurious commits/writes on inspection.
export const READONLY_OPS = new Set(['listThreats', 'validateModel', 'getModelSummary']);

/**
 * @param {Object[]} toolDefinitions tmcore tool definitions ({name, description, input_schema})
 * @returns {Function} ListTools handler
 */
export const makeListToolsHandler = (toolDefinitions) => () => ({
    tools: (toolDefinitions || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema
    }))
});

/**
 * @param {Object} deps { ops, modelStore }
 * @returns {Function} CallTool handler
 */
export const makeCallToolHandler = ({ ops, modelStore }) => async (request) => {
    const { name, arguments: args } = request.params;
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
 * @param {Object} deps optional { tmcore } injection (defaults to lazy-loading shared/tmcore)
 * @returns {Promise<Server>}
 */
export const createMcpServer = async (modelStore, deps = {}) => {
    const tmcore = deps.tmcore || await loadTmcore();
    const { ops, toolDefinitions } = tmcore;

    const server = new Server(
        { name: 'threat-dragon', version: '2.6.2' },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, makeListToolsHandler(toolDefinitions));
    server.setRequestHandler(CallToolRequestSchema, makeCallToolHandler({ ops, modelStore }));

    return server;
};

export default { createMcpServer, makeListToolsHandler, makeCallToolHandler, READONLY_OPS };
