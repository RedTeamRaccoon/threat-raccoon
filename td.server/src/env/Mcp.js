import { Env } from './Env.js';

class McpEnv extends Env {
    constructor () {
        super('Mcp');
    }

    get prefix () {
        return 'MCP_';
    }

    // Note that the actual env var will be prepended with MCP_
    // ALLOWED_ORIGINS / ALLOWED_HOSTS are comma-separated allow-lists for the
    // Streamable HTTP transport's DNS-rebinding / Origin protection.
    get properties () {
        return [
            { key: 'HTTP_ENABLED', required: false, defaultValue: false },
            { key: 'ALLOWED_ORIGINS', required: false },
            { key: 'ALLOWED_HOSTS', required: false }
        ];
    }
}

export default McpEnv;
