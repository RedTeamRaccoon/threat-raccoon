/**
 * @name mcpFileStore
 * @description Desktop model store for the bundled stdio MCP server. Provides the
 * loadModel()/saveModel() seam that td.server's createMcpServer expects, backed by
 * the file currently open in the desktop app. `getFilePath` returns the active model
 * path (managed by the desktop menu/open/save flow).
 */
export const createMcpFileStore = ({ fs, getFilePath }) => ({
    async loadModel() {
        const filePath = getFilePath();
        if (!filePath) {
            throw new Error('No model file is currently open');
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    },
    async saveModel(model) {
        const filePath = getFilePath();
        if (!filePath) {
            throw new Error('No model file is currently open');
        }
        fs.writeFileSync(filePath, JSON.stringify(model, null, 2), 'utf8');
        return true;
    }
});

export default { createMcpFileStore };
