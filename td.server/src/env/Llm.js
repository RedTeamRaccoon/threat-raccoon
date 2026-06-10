import { Env } from './Env.js';

class LlmEnv extends Env {
    constructor () {
        super('Llm');
    }

    get prefix () {
        return 'LLM_';
    }

    // Note that the actual env var will be prepended with LLM_
    // Keys/tokens are intentionally NOT exposed through /api/config (see config.helper.js).
    get properties () {
        return [
            { key: 'ENABLED', required: false, defaultValue: false },
            { key: 'PROVIDER', required: false, defaultValue: 'anthropic' },
            { key: 'ANTHROPIC_API_KEY', required: false },
            { key: 'ANTHROPIC_MODEL', required: false, defaultValue: 'claude-opus-4-8' },
            { key: 'OPENAI_API_KEY', required: false },
            { key: 'OPENAI_MODEL', required: false, defaultValue: 'gpt-4o' },
            { key: 'COPILOT_API_KEY', required: false },
            { key: 'COPILOT_MODEL', required: false, defaultValue: 'gpt-4o' },
            { key: 'CLAUDECODE_OAUTH_TOKEN', required: false },
            { key: 'CLAUDECODE_MODEL', required: false, defaultValue: 'claude-opus-4-8' },
            { key: 'ALLOW_USER_KEY', required: false, defaultValue: false },
            // When true, the local (no-login) session can mint a JWT via
            // GET /api/login/local, enabling the in-app assistant without a Git
            // provider login. Anyone who can reach the server can then use the
            // configured LLM key, so only enable on single-user/localhost
            // deployments.
            { key: 'LOCAL_SESSION', required: false, defaultValue: false }
        ];
    }
}

export default LlmEnv;
