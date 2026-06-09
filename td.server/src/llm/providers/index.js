import anthropic from './anthropic.provider.js';
import claudecode from './claudecode.provider.js';
import copilot from './copilot.provider.js';
import openai from './openai.provider.js';

/**
 * An immutable object containing all LLM providers
 * @type {Object}
 */
const all = Object.freeze({
    anthropic,
    openai,
    copilot,
    claudecode
});

/**
 * Gets a configured LLM provider
 * @param {String} name
 * @throws {Error} If the provider does not exist or is not configured
 * @returns {Object}
 */
const get = (name) => {
    const provider = all[(name || '').toLowerCase()];
    if (!provider) {
        throw new Error(`Unknown LLM provider: ${name}`);
    }
    if (!provider.isConfigured()) {
        throw new Error(`LLM provider ${name} is not configured`);
    }
    return provider;
};

/**
 * Gets a known LLM provider WITHOUT the isConfigured check. Used only on the
 * BYO-key path, where the caller supplies the key instead of the environment.
 * @param {String} name
 * @throws {Error} If the provider does not exist
 * @returns {Object}
 */
const getAllowingUserKey = (name) => {
    const provider = all[(name || '').toLowerCase()];
    if (!provider) {
        throw new Error(`Unknown LLM provider: ${name}`);
    }
    return provider;
};

/**
 * Lists the names of providers that are configured via the environment.
 * @returns {String[]}
 */
const configuredNames = () => Object.keys(all).filter((n) => all[n].isConfigured());

export default {
    all,
    get,
    getAllowingUserKey,
    configuredNames
};
