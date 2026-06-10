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

    let resp;
    try {
        resp = await axios.get(COPILOT_TOKEN_URL, {
            headers: {
                Authorization: `token ${githubToken}`,
                'User-Agent': 'threat-dragon'
            }
        });
    } catch (e) {
        // never rethrow the raw axios error: it carries the GitHub token in its
        // request config, and its message does not say what actually failed
        const status = e.response && e.response.status;
        throw new Error(`Copilot token exchange failed${status ? ` (status ${status})` : ''}`);
    }

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

/**
 * Lists the chat-capable model ids the Copilot account offers.
 * @param {Object} options { apiKey } BYO-key override
 * @returns {Promise<String[]>}
 */
const listModels = async (options = {}) => {
    const configured = options.apiKey || env.get().config.LLM_COPILOT_API_KEY;
    if (!configured) {
        throw new Error('Copilot provider is not configured');
    }
    const bearer = await resolveBearer(configured);

    let resp;
    try {
        resp = await axios.get(`${COPILOT_BASE_URL}/models`, {
            headers: {
                Authorization: `Bearer ${bearer}`,
                'Editor-Version': 'ThreatDragon/2',
                'Copilot-Integration-Id': 'vscode-chat',
                'User-Agent': 'threat-dragon'
            }
        });
    } catch (e) {
        // as with the token exchange: never rethrow the raw axios error (it
        // carries the auth header in its request config)
        const status = e.response && e.response.status;
        throw new Error(`Copilot model listing failed${status ? ` (status ${status})` : ''}`);
    }

    const models = (resp.data && resp.data.data) || [];
    const chat = models.filter((m) => !m.capabilities || m.capabilities.type === 'chat');
    // model_picker_enabled marks the models Copilot offers users in chat UIs;
    // the rest are internal/dated aliases. Keep the configured default while
    // the account still serves it, so an env-pinned model stays selectable.
    const ids = new Set(chat.
        filter((m) => m.model_picker_enabled !== false).
        map((m) => m.id));
    const configuredModel = getModel();
    if (configuredModel && chat.some((m) => m.id === configuredModel)) {
        ids.add(configuredModel);
    }
    return [...ids];
};

// exported for tests
const _resetTokenCache = () => { tokenCache.clear(); };

export default { name, isConfigured, createCompletionStream, listModels, _resetTokenCache };
