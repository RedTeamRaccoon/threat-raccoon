import { isNullish, isString } from './validators.helper.js';
import { ERROR_CODES } from '../constants/errorCodes.js';

const DEFAULT_LOCALE = 'en';
const LOCALE_REGEX = /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/u;
const configError = (code, meta = {}) => ({ code, meta });

export const normalizeLocale = (locale, intl = Intl) => {
    if (!isString(locale)) {return null;}

    const trimmed = locale.trim();
    if (!LOCALE_REGEX.test(trimmed)) {return null;}

    try {
        return intl.getCanonicalLocales(trimmed)[0];
    } catch {
        return null;
    }
};

const toLocaleOrError = (entry, intl) => {
    if (!isString(entry)) {
        return { error: configError(ERROR_CODES.CONFIG_LOCALE_TYPE, { type: typeof entry }) };
    }

    const trimmed = entry.trim();

    if (!LOCALE_REGEX.test(trimmed)) {
        return { error: configError(ERROR_CODES.CONFIG_LOCALE_FORMAT, { locale: entry }) };
    }

    const normalized = normalizeLocale(trimmed, intl);

    return normalized
        ? { value: normalized }
        : { error: configError(ERROR_CODES.CONFIG_LOCALE_BCP47, { locale: entry }) };
};


const parseLocaleInput = (raw) => {
    if (isNullish(raw)) {
        return {
            value: null,
            errors: [configError(ERROR_CODES.CONFIG_LOCALE_MISSING)]
        };
    }

    try {
        const parsed = JSON.parse(raw);

        return Array.isArray(parsed)
            ? { value: parsed, errors: [] }
            : {
                value: null,
                errors: [configError(ERROR_CODES.CONFIG_LOCALE_NOT_ARRAY)]
            };
    } catch {
        return {
            value: null,
            errors: [configError(ERROR_CODES.CONFIG_LOCALE_PARSE)]
        };
    }
};

const validateLocales = (entries, intl) => {
    const values = [];
    const errors = [];

    for (const entry of entries) {
        const result = toLocaleOrError(entry, intl);

        if (result.value) {values.push(result.value);}
        if (result.error) {errors.push(result.error);}
    }

    return {
        value: [...new Set(values)],
        errors
    };
};

export const parseLocalesArray = (raw, intl = Intl) => {
    const { value, errors } = parseLocaleInput(raw);

    return errors.length
        ? { value: null, errors }
        : validateLocales(value, intl);
};

const buildLocaleConfig = (config, intl) => {
    const { value: allowedLocales, errors } =
        parseLocalesArray(config.LOCALES_ALLOWED, intl);

    const hasDefault =
        config.LOCALE_DEFAULT !== null &&
        config.LOCALE_DEFAULT !== undefined;

    const normalizedDefault = normalizeLocale(config.LOCALE_DEFAULT, intl);
    const defaultLocale = normalizedDefault || DEFAULT_LOCALE;

    const defaultErrors =
        !normalizedDefault && hasDefault
            ? [configError(ERROR_CODES.CONFIG_LOCALE_FORMAT, { locale: config.LOCALE_DEFAULT })]
            : [];

    let mergedAllowed = allowedLocales;

    if (
        Array.isArray(allowedLocales) &&
        allowedLocales.length > 0 &&
        !allowedLocales.includes(defaultLocale)
    ) {
        mergedAllowed = [...allowedLocales, defaultLocale];
    }

    return {
        allowedLocales: Array.isArray(mergedAllowed) ? mergedAllowed : [],
        defaultLocale,
        errors: [...errors, ...defaultErrors]
    };
};

const buildOAuthFlags = (config) => ({
    bitbucketEnabled: !isNullish(config.BITBUCKET_CLIENT_ID),
    githubEnabled: !isNullish(config.GITHUB_CLIENT_ID),
    gitlabEnabled: !isNullish(config.GITLAB_CLIENT_ID),
    googleEnabled: !isNullish(config.GOOGLE_CLIENT_ID)
});

const isTrue = (value) => value === 'true' || value === true;

// Static provider metadata. `models` is intentionally just the single
// env-configured model per provider for v1 (no invented catalog).
const LLM_PROVIDER_META = [
    { id: 'anthropic', label: 'Anthropic Claude', keyVar: 'LLM_ANTHROPIC_API_KEY', modelVar: 'LLM_ANTHROPIC_MODEL', defaultModel: 'claude-opus-4-8' },
    { id: 'openai', label: 'OpenAI', keyVar: 'LLM_OPENAI_API_KEY', modelVar: 'LLM_OPENAI_MODEL', defaultModel: 'gpt-4o' },
    { id: 'copilot', label: 'GitHub Copilot', keyVar: 'LLM_COPILOT_API_KEY', modelVar: 'LLM_COPILOT_MODEL', defaultModel: 'gpt-4o' },
    { id: 'claudecode', label: 'Claude Code', keyVar: 'LLM_CLAUDECODE_OAUTH_TOKEN', modelVar: 'LLM_CLAUDECODE_MODEL', defaultModel: 'claude-opus-4-8' }
];

const resolveModel = (config, meta) => config[meta.modelVar] || meta.defaultModel;

const buildLlmProviders = (config) => LLM_PROVIDER_META.
    filter((meta) => !isNullish(config[meta.keyVar])).
    map((meta) => {
        const modelId = resolveModel(config, meta);
        return {
            id: meta.id,
            label: meta.label,
            models: [{ id: modelId, label: modelId }],
            default: modelId
        };
    });

const defaultModelFor = (config, providerId) => {
    const meta = LLM_PROVIDER_META.find((m) => m.id === providerId);
    return meta ? resolveModel(config, meta) : null;
};

// FLAGS / metadata ONLY — never expose provider keys/tokens through /api/config.
const buildLlmFlags = (config) => {
    const llmDefaultProvider = config.LLM_PROVIDER || null;
    return {
        llmEnabled: isTrue(config.LLM_ENABLED),
        llmAllowUserKey: isTrue(config.LLM_ALLOW_USER_KEY),
        llmLocalSession: isTrue(config.LLM_LOCAL_SESSION),
        mcpHttpEnabled: isTrue(config.MCP_HTTP_ENABLED),
        llmDefaultProvider,
        llmDefaultModel: llmDefaultProvider ? defaultModelFor(config, llmDefaultProvider) : null,
        llmProviders: buildLlmProviders(config)
    };
};

export const buildConfig = (config, { intl = Intl } = {}) => {
    const localeConfig = buildLocaleConfig(config, intl);

    return {
        value: Object.freeze({
            ...buildOAuthFlags(config),
            ...buildLlmFlags(config),
            localEnabled: true,
            allowedLocales: Object.freeze([...localeConfig.allowedLocales]),
            defaultLocale: localeConfig.defaultLocale
        }),
        errors: Array.isArray(localeConfig.errors) ? localeConfig.errors : []
    };
};