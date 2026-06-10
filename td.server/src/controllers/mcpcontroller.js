/**
 * @name mcpcontroller
 * @description Wires the authenticated HTTP MCP endpoint. The target model +
 * access token are bound from the authenticated request (req.provider +
 * organisation/repo/branch/model query params), never from MCP tool-call args.
 */
import { createHttpTransport } from '../mcp/httpTransport.js';
import { createMcpServer } from '../mcp/server.js';
import { createRepoStore } from '../mcp/stores/repoStore.js';
import editorContextHelper from '../helpers/editorContext.helper.js';

const createStore = (req) => createRepoStore({
    accessToken: req.provider.access_token,
    modelInfo: {
        organisation: req.query.organisation,
        repo: req.query.repo,
        branch: req.query.branch,
        model: req.query.model
    }
});

// Expose the editor context to MCP clients: prefer the in-memory value (same
// process as the PUT /api/editor/context endpoint), fall back to the state file.
const createServer = (store) => createMcpServer(store, {
    getEditorContext: () => editorContextHelper.get() || editorContextHelper.readFromFile()
});

const transport = createHttpTransport({ createStore, createServer });

const handlePost = (req, res) => transport.handlePost(req, res);
const handleSession = (req, res) => transport.handleSession(req, res);

export default { handlePost, handleSession };
