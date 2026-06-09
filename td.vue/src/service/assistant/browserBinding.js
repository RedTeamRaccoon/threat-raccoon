/**
 * @name browserBinding
 * @description Executes the shared tmcore operation set against the LIVE X6 graph
 * and Vuex store, so the diagram builds in real time as the AI agent works.
 *
 * Each op mirrors a tmcore op name (see shared/tmcore/CONTRACT.md) but applies the
 * change to the currently-selected diagram's live graph rather than a pure JSON doc.
 * Reuses the existing canvas pipeline (graph.addNode/addEdge -> cell:added auto-applies
 * default data/styles/change-tracking, the GraphMeta newThreat sequence, etc.) so the
 * behaviour is identical to a human editing the diagram.
 */
import { v4 as uuidv4 } from 'uuid';

import defaultProperties from '@/service/entity/default-properties.js';
import shapes from '@/service/x6/shapes/index.js';
import saveDiagram from '@/service/diagram/save.js';
import { checkV2 } from '@/service/schema/ajv.js';
import { createNewTypedThreat } from '@/service/threats/index.js';
import dataChanged from '@/service/x6/graph/data-changed.js';
import tmActions from '@/store/actions/threatmodel.js';

const KIND_TO_TYPE = {
    actor: 'tm.Actor',
    process: 'tm.Process',
    store: 'tm.Store'
};

const THREAT_FIELDS = ['title', 'type', 'severity', 'status', 'description', 'mitigation', 'modelType'];

class BindingError extends Error {}

const clone = (obj) => JSON.parse(JSON.stringify(obj));

const createBinding = (graph, store) => {
    const requireGraph = () => {
        if (!graph) {
            throw new BindingError('No diagram is open');
        }
    };

    const requireCell = (cellId) => {
        const cell = graph.getCellById(cellId);
        if (!cell) {
            throw new BindingError(`No element found with id ${cellId}`);
        }
        return cell;
    };

    const runBatched = (name, fn) => {
        graph.startBatch(name);
        try {
            return fn();
        } finally {
            graph.stopBatch(name);
        }
    };

    // Build a v2 model snapshot: the persisted model with the open diagram's cells
    // replaced by the live graph contents.
    const buildModelSnapshot = () => {
        const data = store.state.threatmodel.data || {};
        const model = clone(data);
        const selected = store.state.threatmodel.selectedDiagram;
        if (graph && model.detail && Array.isArray(model.detail.diagrams) && selected && selected.id != null) {
            const idx = model.detail.diagrams.findIndex((d) => d.id === selected.id);
            if (idx >= 0) {
                model.detail.diagrams[idx] = clone(saveDiagram.serialize(graph, selected));
            }
        }
        return model;
    };

    const nextPosition = () => {
        const count = graph.getNodes().length;
        return { x: 80 + (count % 5) * 180, y: 80 + Math.floor(count / 5) * 150 };
    };

    const ops = {
        // In the browser the user always works on the open diagram; report it so the
        // agent has a diagramId to thread through later calls.
        createDiagram() {
            const selected = store.state.threatmodel.selectedDiagram || {};
            return { diagramId: selected.id };
        },

        addElement({ kind, name, position, description, properties }) {
            const type = KIND_TO_TYPE[kind];
            if (!type) {
                throw new BindingError(`Unknown element kind "${kind}" (expected actor, process or store)`);
            }
            if (!name) {
                throw new BindingError('addElement requires a name');
            }

            return runBatched('assistant-add-element', () => {
                const entity = defaultProperties.defaultEntity(type);
                entity.id = uuidv4();
                entity.position = position && position.x != null ? { x: position.x, y: position.y } : nextPosition();
                entity.data.name = name;
                if (description) {
                    entity.data.description = description;
                }
                if (properties && typeof properties === 'object') {
                    Object.assign(entity.data, properties);
                }
                const cell = graph.addNode(entity);
                cell.setName(name);
                return { cellId: cell.id };
            });
        },

        connectFlow({ sourceId, targetId, name, protocol, properties }) {
            const source = requireCell(sourceId);
            const target = requireCell(targetId);

            return runBatched('assistant-connect-flow', () => {
                const data = defaultProperties.defaultData('tm.Flow');
                if (name) {
                    data.name = name;
                }
                if (protocol) {
                    data.protocol = protocol;
                }
                if (properties && typeof properties === 'object') {
                    Object.assign(data, properties);
                }
                const flow = new shapes.Flow({
                    source: { cell: source.id },
                    target: { cell: target.id },
                    data
                });
                graph.addEdge(flow);
                flow.setName(data.name);
                return { cellId: flow.id };
            });
        },

        addBoundary({ kind, name, position, size, source, target }) {
            return runBatched('assistant-add-boundary', () => {
                if (kind === 'curve') {
                    const data = defaultProperties.defaultData('tm.Boundary');
                    if (name) {
                        data.name = name;
                    }
                    const curve = new shapes.TrustBoundaryCurve({
                        source: source || { x: 80, y: 80 },
                        target: target || { x: 280, y: 280 },
                        data
                    });
                    graph.addEdge(curve);
                    if (name) {
                        curve.setName(name);
                    }
                    return { cellId: curve.id };
                }

                // default: box
                const entity = defaultProperties.defaultEntity('tm.BoundaryBox');
                entity.id = uuidv4();
                entity.position = position && position.x != null ? { x: position.x, y: position.y } : { x: 60, y: 60 };
                entity.size = size && size.width ? { width: size.width, height: size.height } : { width: 320, height: 240 };
                if (name) {
                    entity.data.name = name;
                }
                const cell = graph.addNode(entity);
                if (name) {
                    cell.setName(name);
                }
                return { cellId: cell.id };
            });
        },

        addThreat({ cellId, threat }) {
            const cell = requireCell(cellId);
            const diagramType = (store.state.threatmodel.selectedDiagram || {}).diagramType;
            const threatTop = store.state.threatmodel.data.detail.threatTop;
            const number = threatTop + 1;

            return runBatched('assistant-add-threat', () => {
                const data = clone(cell.getData() || {});
                data.threats = data.threats || [];

                const newThreat = createNewTypedThreat(diagramType, data.type, number);
                if (threat && typeof threat === 'object') {
                    THREAT_FIELDS.forEach((field) => {
                        if (threat[field] !== undefined) {
                            newThreat[field] = threat[field];
                        }
                    });
                }
                data.threats.push(newThreat);
                data.hasOpenThreats = data.threats.some((t) => (t.status || '').toLowerCase() === 'open');

                // setData (overwrite) triggers cell:change:data -> updateStyleAttrs + modified.
                cell.setData(data, { overwrite: true });
                store.dispatch(tmActions.update, { threatTop: number });
                store.dispatch(tmActions.modified);
                dataChanged.updateStyleAttrs(cell);

                return { threatId: newThreat.id, number };
            });
        },

        updateElement({ cellId, patch }) {
            const cell = requireCell(cellId);
            const change = patch || {};

            return runBatched('assistant-update-element', () => {
                if (cell.isNode && cell.isNode()) {
                    if (change.position && change.position.x != null) {
                        cell.position(change.position.x, change.position.y);
                    }
                    if (change.size && change.size.width) {
                        cell.resize(change.size.width, change.size.height);
                    }
                }

                const data = clone(cell.getData() || {});
                if (change.description !== undefined) {
                    data.description = change.description;
                }
                if (change.properties && typeof change.properties === 'object') {
                    Object.assign(data, change.properties);
                }
                if (change.name !== undefined) {
                    data.name = change.name;
                }
                cell.setData(data, { overwrite: true });
                if (change.name !== undefined && cell.setName) {
                    cell.setName(change.name);
                }
                dataChanged.updateStyleAttrs(cell);
                return { cellId: cell.id };
            });
        },

        removeElement({ cellId }) {
            const cell = requireCell(cellId);
            return runBatched('assistant-remove-element', () => {
                const removed = [cellId];
                // prune flows referencing the removed element
                graph.getEdges().forEach((edge) => {
                    const src = edge.getSourceCellId && edge.getSourceCellId();
                    const tgt = edge.getTargetCellId && edge.getTargetCellId();
                    if (src === cellId || tgt === cellId) {
                        removed.push(edge.id);
                        edge.remove();
                    }
                });
                cell.remove();
                return { removed };
            });
        },

        listThreats({ filters } = {}) {
            const model = buildModelSnapshot();
            const opts = filters || {};
            const diagrams = (model.detail && model.detail.diagrams) || [];
            const threats = diagrams
                .flatMap((d) => d.cells || [])
                .filter((c) => c.data && Array.isArray(c.data.threats))
                .filter((c) => opts.showOutOfScope || !c.data.outOfScope)
                .flatMap((c) => c.data.threats
                    .filter((t) => opts.showMitigated || (t.status || '').toLowerCase() !== 'mitigated')
                    .map((t) => ({ ...t, cellId: c.id, element: c.data.name })));
            return { threats };
        },

        getModelSummary() {
            const model = buildModelSnapshot();
            const diagrams = (model.detail && model.detail.diagrams) || [];
            const bySeverity = {};
            let elements = 0;
            let threats = 0;
            let openThreats = 0;

            const summary = diagrams.map((d) => {
                const cells = d.cells || [];
                const elementCount = cells.length;
                const cellThreats = cells
                    .filter((c) => c.data && Array.isArray(c.data.threats))
                    .flatMap((c) => c.data.threats);
                elements += elementCount;
                threats += cellThreats.length;
                cellThreats.forEach((t) => {
                    if ((t.status || '').toLowerCase() === 'open') {
                        openThreats += 1;
                    }
                    const sev = t.severity || 'TBD';
                    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
                });
                return {
                    id: d.id,
                    title: d.title,
                    diagramType: d.diagramType,
                    elementCount,
                    threatCount: cellThreats.length
                };
            });

            return { diagrams: summary, totals: { elements, threats, openThreats, bySeverity } };
        },

        validateModel() {
            const model = buildModelSnapshot();
            // Validate with the browser's own AJV (same v2 schema). tmcore's validateModel
            // pulls node:module and must never enter the browser bundle.
            const errors = checkV2(model);
            return { valid: !errors, errors: errors || null };
        }
    };

    const MUTATING = new Set([
        'addElement', 'connectFlow', 'addBoundary', 'addThreat', 'updateElement', 'removeElement'
    ]);

    /**
     * Execute a single operation. Never throws into the agent loop: failures are
     * returned as { ok:false, error } so the agent can self-correct via an is_error
     * tool_result.
     * @param {string} opName
     * @param {object} args
     * @returns {Promise<{ ok:boolean, result?:object, error?:string }>}
     */
    const execute = async (opName, args = {}) => {
        const op = ops[opName];
        if (!op) {
            return { ok: false, error: `Unknown operation "${opName}"` };
        }
        try {
            if (MUTATING.has(opName)) {
                requireGraph();
            }
            const result = await op(args || {});
            return { ok: true, result };
        } catch (err) {
            console.warn(`assistant op "${opName}" failed:`, err);
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    };

    return { execute };
};

export default { createBinding };
export { createBinding };
