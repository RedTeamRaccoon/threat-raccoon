/**
 * @name editorContextReporter
 * @description Best-effort reporting of where the user currently is in the
 * editor (dashboard / model overview / diagram) to the server's JWT-gated
 * PUT /api/editor/context endpoint, so server-side AI integrations (e.g. the
 * MCP server) know what the user is looking at.
 *
 * Fire-and-forget by design: it must never disturb the UI. No-ops on desktop
 * (no backend) and when the user has no JWT; all failures are swallowed.
 */
import isElectron from 'is-electron';

import api from '@/service/api/api.js';
import storeFactory from '@/store/index.js';

/**
 * Report the current editor context.
 * @param {{ page: string, modelTitle?: string, diagramId?: number|string, diagramTitle?: string }} context
 * @returns {Promise<void>}
 */
const report = async (context) => {
    try {
        if (isElectron()) {
            return;
        }
        const store = storeFactory.get();
        if (!store.state.auth || !store.state.auth.jwt) {
            return;
        }
        await api.putAsync('/api/editor/context', context || {});
    } catch (e) {
        console.debug('editor context report failed', e);
    }
};

export default { report };
export { report };
