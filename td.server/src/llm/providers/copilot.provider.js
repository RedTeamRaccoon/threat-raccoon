/**
 * @name copilot
 * @description LLM provider adapter for GitHub Copilot. Copilot exposes an
 * OpenAI-compatible chat-completions API at https://api.githubcopilot.com, so
 * this reuses the OpenAI translation with a different base URL + auth headers.
 *
 * The configured value is a single "Copilot API key". If a raw GitHub token is
 * supplied (gho_/ghu_/ghp_/ghs_/github_pat_), it is exchanged for a short-lived
 * Copilot bearer transparently and cached until shortly before it expires.
 */
import axios from 'axios';
import crypto from 'crypto';
import OpenAI from 'openai';

import env from '../../env/Env.js';
import { streamOpenAi } from './openaiTranslate.js';

const name = 'copilot';
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

// Keyed by a hash of the INPUT GitHub token so that, under the BYO-key path,
// one user's exchanged Copilot bearer can never be served to another user.
const tokenCache = new Map(); // sha256(githubToken) -> { token, expiresAt }

const isConfigured = () => Boolean(env.get().config.LLM_COPILOT_API_KEY);

const getModel = () => env.get().config.LLM_COPILOT_MODEL || 'gpt-4o';

const isGithubToken = (key) => (/^(?:gho_|ghu_|ghp_|ghs_|github_pat_)/u).test(key || '');

const hashToken = (token) => crypto.createHash('sha256').update(token).
    digest('hex');

const exchangeGithubToken = async (githubToken) => {
    const key = hashToken(githubToken);
    const hit = tokenCache.get(key);
    if (hit && hit.expiresAt > Date.now() + 60000) {
        return hit.token;
    }

    const resp = await axios.get(COPILOT_TOKEN_URL, {
        headers: {
            Authorization: `token ${githubToken}`,
            'User-Agent': 'threat-dragon'
        }
    });

    const token = resp.data.token;
    const expiresAt = resp.data.expires_at
        ? resp.data.expires_at * 1000
        : Date.now() + (25 * 60 * 1000);
    tokenCache.set(key, { token, expiresAt });
    return token;
};

const resolveBearer = (configured) => (isGithubToken(configured) ? exchangeGithubToken(configured) : Promise.resolve(configured));

async function *createCompletionStream (normalizedRequest, options = {}) {
    const configured = options.apiKey || env.get().config.LLM_COPILOT_API_KEY;
    if (!configured) {
        throw new Error('Copilot provider is not configured');
    }

    const bearer = await resolveBearer(configured);
    const client = new OpenAI({
        apiKey: bearer,
        baseURL: COPILOT_BASE_URL,
        defaultHeaders: {
            'Editor-Version': 'ThreatDragon/2',
            'Copilot-Integration-Id': 'vscode-chat'
        }
    });

    yield* streamOpenAi(client, {
        model: normalizedRequest.model || getModel(),
        normalizedRequest,
        signal: options.signal
    });
}

// exported for tests
const _resetTokenCache = () => { tokenCache.clear(); };

export default { name, isConfigured, createCompletionStream, _resetTokenCache };
