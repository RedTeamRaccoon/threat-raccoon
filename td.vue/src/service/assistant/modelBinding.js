/**
 * @name modelBinding
 * @description Executes the shared tmcore operation set against the Vuex
 * threat-model JSON (state.threatmodel.data) — no canvas required. Used by the
 * assistant on the threat model OVERVIEW page for bulk work across diagrams.
 *
 * Unlike browserBinding (which drives the LIVE X6 graph of the open diagram),
 * this binding reuses the PURE tmcore ops `(model, args) -> { model, result }`
 * directly: each mutating op runs against a deep clone of the current model and
 * the returned model replaces state.threatmodel.data (dataReplaced + modified),
 * so dirty-tracking and save flows behave exactly as after a human edit.
 *
 * NOTE: '@tmcore/ops.js' imports './validate.js', which webpack/jest substitute
 * with the browser shim src/service/schema/tmcoreValidate.js (see vue.config.js
 * and jest.config.js) because the tmcore original pulls node:module.
 */
import { ops as tmcoreOps } from '@tmcore/ops.js';

import tmActions from '@/store/actions/threatmodel.js';

const READONLY = new Set(['listThreats', 'validateModel', 'getModelSummary']);

const clone = (obj) => JSON.parse(JSON.stringify(obj));

/**
 * Create a binding with the same execute contract as browserBinding:
 * never throws; failures come back as { ok:false, error }.
 * @param {object} store the Vuex store
 * @returns {{ execute: Function }}
 */
const createModelBinding = (store) => {
    /**
     * Execute a single tmcore operation against the stored model.
     * @param {string} opName
     * @param {object} args
     * @returns {Promise<{ ok:boolean, result?:object, error?:string }>}
     */
    const execute = async (opName, args = {}) => {
        const op = tmcoreOps[opName];
        if (!op) {
            return { ok: false, error: `Unknown operation "${opName}"` };
        }
        try {
            const data = store.state.threatmodel.data;
            if (!data || !Object.keys(data).length || !data.detail) {
                return { ok: false, error: 'No threat model is open' };
            }
            const { model, result } = op(clone(data), args || {});
            if (!READONLY.has(opName)) {
                store.dispatch(tmActions.dataReplaced, model);
                store.dispatch(tmActions.modified);
            }
            return { ok: true, result };
        } catch (err) {
            console.warn(`assistant model op "${opName}" failed:`, err);
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    };

    return { execute };
};

export default { createModelBinding };
export { createModelBinding };
