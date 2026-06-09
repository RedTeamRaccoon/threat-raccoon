/**
 * @name stdioEntry
 * @description Standalone stdio MCP server entrypoint so external agents (Claude
 * Desktop/Code, Cursor) — and the desktop app — can spawn `node stdioEntry.js`.
 * Uses a file-backed model store pointed at a local threat-model JSON file
 * (TD_MODEL_FILE env var or argv[2]).
 *
 * `createMcpServer` is exported from ./server.js so the desktop app can inject
 * its own file-backed store instead of using the default one here.
 */
import fs from 'fs';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpServer } from './server.js';

export const createFileStore = (filePath) => ({
    loadModel: () => JSON.parse(fs.readFileSync(filePath, 'utf8')),
    saveModel: (model) => fs.writeFileSync(filePath, JSON.stringify(model, null, 2))
});

const main = async () => {
    const filePath = process.env.TD_MODEL_FILE || process.argv[2];
    if (!filePath) {
        process.stderr.write('Usage: node stdioEntry.js <model.json>  (or set TD_MODEL_FILE)\n');
        process.exit(1);
        return;
    }

    const server = await createMcpServer(createFileStore(filePath));
    const transport = new StdioServerTransport();
    await server.connect(transport);
};

// Only run when invoked directly, not when imported by tests.
if (require.main === module) {
    main().catch((e) => {
        process.stderr.write(`${(e && e.stack) || e}\n`);
        process.exit(1);
    });
}

export default { createFileStore };
