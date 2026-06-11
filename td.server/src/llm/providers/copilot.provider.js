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
 * True when the raw Copilot model entry can actually be driven by the
 * assistant: a chat model exposed over /chat/completions that streams and
 * supports tool calls.
 *
 * Semantics (designed from the live /models payload):
 *  - capabilities.type must be 'chat' (embeddings models are excluded here).
 *  - supports.streaming / supports.tool_calls: a chat model with these flags
 *    EXPLICITLY false is excluded. Older payloads still carry both flags as
 *    true; if the whole `supports` object is absent we keep the model (legacy
 *    shape), but if `supports` exists with a flag missing-or-false we drop it —
 *    we will not assume a capability the payload could have declared and didn't.
 *  - supported_endpoints, when present as an array, MUST include
 *    '/chat/completions' (the responses-only models — gpt-5.5 etc — fail here).
 *    An absent/undefined supported_endpoints is the legacy shape and is kept.
 * @param {Object} m raw Copilot model entry
 * @returns {Boolean}
 */
const isUsableChatModel = (m) => {
    const caps = m.capabilities || {};
    if (caps.type !== 'chat') {
        return false;
    }
    const supports = caps.supports;
    if (supports) {
        if (supports.streaming !== true || supports.tool_calls !== true) {
            return false;
        }
    }
    const endpoints = m.supported_endpoints;
    if (Array.isArray(endpoints) && !endpoints.includes('/chat/completions')) {
        return false;
    }
    return true;
};

const visionOf = (m) => Boolean(m.capabilities && m.capabilities.supports && m.capabilities.supports.vision === true);

/**
 * Lists the chat-capable models the Copilot account offers as { id, vision }
 * objects (vision boolean). Only models the assistant can actually drive are
 * returned (see isUsableChatModel).
 * @param {Object} options { apiKey } BYO-key override
 * @returns {Promise<Array<{id: String, vision: Boolean}>>}
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
    // Only models that pass the compatibility filter are eligible at all, so a
    // responses-only model can never reappear (not even via the default below).
    const usable = models.filter(isUsableChatModel);
    // model_picker_enabled marks the models Copilot offers users in chat UIs;
    // the rest are internal/dated aliases. Keep the configured default while
    // the account still serves it AND it passes the same compatibility filter,
    // so an env-pinned (but still usable) model stays selectable.
    const seen = new Set();
    const out = [];
    const add = (m) => {
        if (!seen.has(m.id)) {
            seen.add(m.id);
            out.push({ id: m.id, vision: visionOf(m) });
        }
    };
    usable.filter((m) => m.model_picker_enabled !== false).forEach(add);
    const configuredModel = getModel();
    if (configuredModel) {
        const def = usable.find((m) => m.id === configuredModel);
        if (def) {
            add(def);
        }
    }
    return out;
};

// exported for tests
const _resetTokenCache = () => { tokenCache.clear(); };

export default { name, isConfigured, createCompletionStream, listModels, _resetTokenCache };
