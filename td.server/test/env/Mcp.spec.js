import { expect } from 'chai';

import { Env } from '../../src/env/Env.js';
import Mcp from '../../src/env/Mcp.js';

describe('env/Mcp.js', () => {
    let mcpEnv;

    beforeEach(() => {
        mcpEnv = new Mcp();
    });

    it('extends Env', () => {
        expect(mcpEnv).is.instanceOf(Env);
    });

    it('uses the MCP_ prefix', () => {
        expect(mcpEnv.prefix).to.eq('MCP_');
    });

    it('defaults HTTP_ENABLED to false', () => {
        const value = mcpEnv.properties.find((x) => x.key === 'HTTP_ENABLED').defaultValue;
        expect(value).to.be.false;
    });
});
