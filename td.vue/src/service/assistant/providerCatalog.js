/**
 * @name providerCatalog
 * @description Client-side catalogue of the LLM providers the assistant supports.
 * Used in DESKTOP mode (no backend /api/config) to populate the settings modal
 * (which providers a user can configure a key for) and the panel selectors. In
 * server mode the equivalent list comes from /api/config `llmProviders`.
 */
export const PROVIDER_CATALOG = [
    {
        id: 'anthropic',
        label: 'Anthropic (Claude)',
        default: true,
        models: [{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }]
    },
    {
        id: 'openai',
        label: 'OpenAI',
        models: [{ id: 'gpt-4o', label: 'GPT-4o' }]
    },
    {
        id: 'copilot',
        label: 'GitHub Copilot',
        models: [{ id: 'gpt-4o', label: 'GPT-4o' }]
    },
    {
        id: 'claudecode',
        label: 'Claude Code (OAuth)',
        models: [{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }]
    }
];

export const findProvider = (id) => PROVIDER_CATALOG.find((p) => p.id === id) || null;

export default { PROVIDER_CATALOG, findProvider };
