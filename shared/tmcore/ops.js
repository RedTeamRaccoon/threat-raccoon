import { v4 as uuidv4 } from 'uuid';

import { validateModel } from './validate.js';
import taxonomy from './taxonomy.js';

/**
 * Structured error thrown when an operation produces an invalid model
 * (or receives invalid arguments). Carries AJV `.errors` when relevant.
 */
export class TmcoreError extends Error {
    constructor(message, errors = null) {
        super(message);
        this.name = 'TmcoreError';
        this.errors = errors;
    }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// --- cell templates (i18n-decoupled mirror of default-properties.js) -------

const DEFAULT_NAMES = {
    actor: 'Actor',
    process: 'Process',
    store: 'Store',
    flow: 'Data flow',
    boundary: 'Trust boundary'
};

const buildActor = (name) => ({
    position: { x: 0, y: 0 },
    size: { width: 150, height: 80 },
    label: name,
    shape: 'actor',
    zIndex: 0,
    data: {
        type: 'tm.Actor',
        name,
        description: '',
        isTrustBoundary: false,
        outOfScope: false,
        reasonOutOfScope: '',
        hasOpenThreats: false,
        providesAuthentication: false,
        threats: []
    }
});

const buildProcess = (name) => ({
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    attrs: {
        text: { text: name },
        body: { stroke: '#333333', strokeWidth: 1.5, strokeDasharray: null }
    },
    shape: 'process',
    zIndex: 0,
    data: {
        type: 'tm.Process',
        name,
        description: '',
        outOfScope: false,
        isTrustBoundary: false,
        reasonOutOfScope: '',
        hasOpenThreats: false,
        handlesCardPayment: false,
        handlesGoodsOrServices: false,
        isWebApplication: false,
        privilegeLevel: '',
        threats: []
    }
});

const buildStore = (name) => ({
    position: { x: 0, y: 0 },
    size: { width: 150, height: 75 },
    attrs: {
        text: { text: name },
        topLine: { strokeWidth: 1.5, strokeDasharray: null },
        bottomLine: { strokeWidth: 1.5, strokeDasharray: null }
    },
    shape: 'store',
    zIndex: 0,
    data: {
        type: 'tm.Store',
        name,
        description: '',
        outOfScope: false,
        isTrustBoundary: false,
        reasonOutOfScope: '',
        hasOpenThreats: false,
        isALog: false,
        isEncrypted: false,
        isSigned: false,
        storesCredentials: false,
        storesInventory: false,
        threats: []
    }
});

const NODE_BUILDERS = {
    actor: buildActor,
    process: buildProcess,
    store: buildStore
};

const buildFlow = (name) => ({
    attrs: {
        line: {
            stroke: '#333333',
            strokeWidth: 1.5,
            targetMarker: { name: 'block' },
            sourceMarker: { name: '' },
            strokeDasharray: null
        }
    },
    shape: 'flow',
    zIndex: 10,
    width: 200,
    height: 100,
    connector: 'smooth',
    labels: [
        {
            // Authoritative hand-built flow-label shape: selector 'label'
            // (NOT 'labelText') and a numeric position, so the name actually
            // renders. TD only syncs name->label on interactive edit, not on
            // fromJSON load, so the generated JSON must carry it directly.
            position: 0.5,
            attrs: { label: { text: name } }
        }
    ],
    data: {
        type: 'tm.Flow',
        name,
        description: '',
        outOfScope: false,
        isTrustBoundary: false,
        reasonOutOfScope: '',
        hasOpenThreats: false,
        isBidirectional: false,
        isEncrypted: false,
        isPublicNetwork: false,
        protocol: '',
        threats: [],
        trustBoundaryIds: []
    },
    source: { cell: '', port: '' },
    target: { cell: '', port: '' },
    vertices: []
});

const buildBoundaryBox = (name) => ({
    position: { x: 0, y: 0 },
    size: { width: 200, height: 150 },
    // an OBJECT under the 'label' selector: it merges with the shape's label
    // attrs (top-left placement); a bare string would replace them and the
    // label would render centered in the box.
    attrs: { label: { text: name } },
    shape: 'trust-boundary-box',
    // Boundaries sit BEHIND components so they don't intercept clicks
    // (mirrors the runtime rule in td.vue x6/graph/events.js).
    zIndex: -1,
    data: {
        type: 'tm.BoundaryBox',
        name,
        description: '',
        isTrustBoundary: true,
        hasOpenThreats: false,
        crossingFlows: [],
        containedElements: []
    }
});

const buildBoundaryCurve = (name) => ({
    // Edges render names from the labels API, not attrs (same hand-built shape
    // as buildFlow: selector 'label', numeric position).
    labels: [
        {
            position: 0.5,
            attrs: { label: { text: name } }
        }
    ],
    // Must be the registered edge shape 'trust-boundary-curve' (x6/shapes/index.js);
    // bare 'trust-boundary' is unregistered and won't render when re-opened.
    shape: 'trust-boundary-curve',
    // Boundaries sit BEHIND components (see td.vue x6/graph/events.js).
    zIndex: -1,
    connector: 'smooth',
    data: {
        type: 'tm.Boundary',
        name,
        description: '',
        isTrustBoundary: true,
        hasOpenThreats: false,
        crossingFlows: [],
        containedElements: []
    },
    source: { x: 0, y: 0 },
    target: { x: 100, y: 100 },
    vertices: []
});

// --- helpers ---------------------------------------------------------------

const findDiagram = (model, diagramId) => {
    const diagram = model.detail.diagrams.find((d) => d.id === diagramId);
    if (!diagram) {
        throw new TmcoreError(`Diagram not found: ${diagramId}`);
    }
    return diagram;
};

const findCell = (diagram, cellId) => {
    const cell = diagram.cells.find((c) => c.id === cellId);
    if (!cell) {
        throw new TmcoreError(`Cell not found: ${cellId}`);
    }
    return cell;
};

const isOpen = (threat) => !!threat.status && threat.status.toLowerCase() === 'open';

const refreshOpenThreats = (cell) => {
    const threats = (cell.data && cell.data.threats) || [];
    cell.data.hasOpenThreats = threats.some(isOpen);
};

const setCellName = (cell, name) => {
    cell.data.name = name;
    if (cell.attrs && cell.attrs.text) {
        cell.attrs.text.text = name;
    } else if (cell.shape === 'actor') {
        cell.label = name;
    } else if (Array.isArray(cell.labels) && cell.labels[0] && cell.labels[0].attrs && cell.labels[0].attrs.label) {
        // edges (flows, boundary curves) render names from the labels API
        cell.labels[0].attrs.label.text = name;
    } else if (cell.attrs && 'label' in cell.attrs) {
        // keep the label an OBJECT: a bare string replaces the shape's label
        // attrs and re-centers boundary-box labels
        cell.attrs.label = { ...(typeof cell.attrs.label === 'object' ? cell.attrs.label : {}), text: name };
    }
};

// Validate output of a mutating op; throw TmcoreError if the model is invalid.
const assertValid = (model) => {
    const { valid, errors } = validateModel(model);
    if (!valid) {
        throw new TmcoreError('Operation produced an invalid threat model', errors);
    }
    return model;
};

// --- operations ------------------------------------------------------------

const createDiagram = (model, { title, diagramType }) => {
    const next = clone(model);
    const id = next.detail.diagramTop;
    next.detail.diagrams.push({
        id,
        title: title ?? `Diagram ${id}`,
        description: '',
        diagramType: diagramType ?? 'STRIDE',
        version: next.version || '2.0',
        thumbnail: '',
        cells: []
    });
    next.detail.diagramTop = id + 1;
    return { model: assertValid(next), result: { diagramId: id } };
};

// Placement safety net (NOT an auto-layout: existing elements are never moved).
// Models sometimes omit positions or stack elements; an omitted position gets
// the next free grid slot, and a position that lands on top of an existing
// component is nudged diagonally until it is clear.
const GRID_X = 220;
const GRID_Y = 160;
const GRID_ORIGIN = 80;
const GRID_COLS = 4;
const COLLISION_DISTANCE = 60;

const COMPONENT_SHAPES = new Set(['actor', 'process', 'store']);

const componentPositions = (diagram) => (diagram.cells || []).
    filter((c) => COMPONENT_SHAPES.has(c.shape) && c.position).
    map((c) => c.position);

const collides = (position, occupied) => occupied.some((p) =>
    Math.abs(p.x - position.x) < COLLISION_DISTANCE && Math.abs(p.y - position.y) < COLLISION_DISTANCE);

const nextFreeGridSlot = (diagram) => {
    const occupied = componentPositions(diagram);
    for (let slot = 0; slot < 1000; slot += 1) {
        const candidate = {
            x: GRID_ORIGIN + (slot % GRID_COLS) * GRID_X,
            y: GRID_ORIGIN + Math.floor(slot / GRID_COLS) * GRID_Y
        };
        if (!collides(candidate, occupied)) {
            return candidate;
        }
    }
    return { x: GRID_ORIGIN, y: GRID_ORIGIN };
};

const nudgeClear = (position, diagram) => {
    const occupied = componentPositions(diagram);
    const candidate = { x: position.x, y: position.y };
    for (let step = 0; step < 20 && collides(candidate, occupied); step += 1) {
        candidate.x += COLLISION_DISTANCE;
        candidate.y += COLLISION_DISTANCE;
    }
    return candidate;
};

const addElement = (model, { diagramId, kind, name, position, description, properties }) => {
    const builder = NODE_BUILDERS[kind];
    if (!builder) {
        throw new TmcoreError(`Unknown element kind: ${kind}`);
    }
    const next = clone(model);
    const diagram = findDiagram(next, diagramId);

    const cell = builder(name || DEFAULT_NAMES[kind]);
    cell.id = uuidv4();
    cell.position = position && position.x != null
        ? nudgeClear(position, diagram)
        : nextFreeGridSlot(diagram);
    if (description !== undefined) {
        cell.data.description = description;
    }
    if (properties) {
        Object.assign(cell.data, properties);
    }
    diagram.cells.push(cell);
    return { model: assertValid(next), result: { cellId: cell.id } };
};

const connectFlow = (model, { diagramId, sourceId, targetId, name, protocol, properties }) => {
    const next = clone(model);
    const diagram = findDiagram(next, diagramId);
    findCell(diagram, sourceId);
    findCell(diagram, targetId);

    const cell = buildFlow(name || DEFAULT_NAMES.flow);
    cell.id = uuidv4();
    cell.source = { cell: sourceId, port: '' };
    cell.target = { cell: targetId, port: '' };
    if (protocol !== undefined) {
        cell.data.protocol = protocol;
    }
    if (properties) {
        Object.assign(cell.data, properties);
    }
    diagram.cells.push(cell);
    return { model: assertValid(next), result: { cellId: cell.id } };
};

const addBoundary = (model, { diagramId, kind, name, position, size, source, target }) => {
    if (kind !== 'box' && kind !== 'curve') {
        throw new TmcoreError(`Unknown boundary kind: ${kind}`);
    }
    const next = clone(model);
    const diagram = findDiagram(next, diagramId);

    const cell = kind === 'box'
        ? buildBoundaryBox(name || DEFAULT_NAMES.boundary)
        : buildBoundaryCurve(name || DEFAULT_NAMES.boundary);
    cell.id = uuidv4();

    if (kind === 'box') {
        if (position) {
            cell.position = { x: position.x, y: position.y };
        }
        if (size) {
            cell.size = { width: size.width, height: size.height };
        }
    } else {
        if (source) {
            cell.source = { x: source.x, y: source.y };
        }
        if (target) {
            cell.target = { x: target.x, y: target.y };
        }
    }
    diagram.cells.push(cell);
    return { model: assertValid(next), result: { cellId: cell.id } };
};

const addThreat = (model, { diagramId, cellId, threat = {} }) => {
    const next = clone(model);
    const diagram = findDiagram(next, diagramId);
    const cell = findCell(diagram, cellId);

    const number = next.detail.threatTop + 1;
    const modelType = threat.modelType || diagram.diagramType;
    const cellType = cell.data && cell.data.type;

    const created = taxonomy.createTypedThreat({
        modelType,
        cellType,
        number,
        title: threat.title,
        type: threat.type,
        severity: threat.severity,
        status: threat.status,
        description: threat.description,
        mitigation: threat.mitigation
    });

    if (!cell.data.threats) {
        cell.data.threats = [];
    }
    cell.data.threats.push(created);
    refreshOpenThreats(cell);
    next.detail.threatTop = number;

    return { model: assertValid(next), result: { threatId: created.id, number } };
};

const updateElement = (model, { diagramId, cellId, patch = {} }) => {
    const next = clone(model);
    const diagram = findDiagram(next, diagramId);
    const cell = findCell(diagram, cellId);

    if (patch.name !== undefined) {
        setCellName(cell, patch.name);
    }
    if (patch.description !== undefined) {
        cell.data.description = patch.description;
    }
    if (patch.position) {
        cell.position = { x: patch.position.x, y: patch.position.y };
    }
    if (patch.size) {
        cell.size = { width: patch.size.width, height: patch.size.height };
    }
    if (patch.properties) {
        Object.assign(cell.data, patch.properties);
    }
    return { model: assertValid(next), result: { cellId } };
};

const removeElement = (model, { diagramId, cellId }) => {
    const next = clone(model);
    const diagram = findDiagram(next, diagramId);
    findCell(diagram, cellId);

    const prunedFlowIds = diagram.cells
        .filter((c) => c.id !== cellId)
        .filter((c) => c.source && c.target &&
            (c.source.cell === cellId || c.target.cell === cellId))
        .map((c) => c.id);

    const removeSet = new Set([cellId, ...prunedFlowIds]);
    diagram.cells = diagram.cells.filter((c) => !removeSet.has(c.id));

    return { model: assertValid(next), result: { removed: [cellId, ...prunedFlowIds] } };
};

const listThreats = (model, { diagramId, filters = {} } = {}) => {
    const { showOutOfScope = false, showMitigated = false } = filters;
    const diagrams = diagramId !== undefined
        ? model.detail.diagrams.filter((d) => d.id === diagramId)
        : model.detail.diagrams;

    const threats = [];
    diagrams.forEach((diagram) => {
        diagram.cells.forEach((cell) => {
            if (!cell.data || !Array.isArray(cell.data.threats)) {
                return;
            }
            if (!showOutOfScope && cell.data.outOfScope) {
                return;
            }
            cell.data.threats.forEach((threat) => {
                if (!showMitigated && threat.status &&
                    threat.status.toLowerCase() === 'mitigated') {
                    return;
                }
                threats.push({ ...threat, cellId: cell.id, diagramId: diagram.id });
            });
        });
    });

    return { model, result: { threats } };
};

const validateModelOp = (model) => {
    return { model, result: validateModel(model) };
};

const getModelSummary = (model) => {
    const totals = { elements: 0, threats: 0, openThreats: 0, bySeverity: {} };
    const diagrams = model.detail.diagrams.map((diagram) => {
        let threatCount = 0;
        diagram.cells.forEach((cell) => {
            const threats = (cell.data && cell.data.threats) || [];
            threatCount += threats.length;
            threats.forEach((threat) => {
                if (isOpen(threat)) {
                    totals.openThreats += 1;
                }
                const sev = threat.severity || 'TBD';
                totals.bySeverity[sev] = (totals.bySeverity[sev] || 0) + 1;
            });
        });
        totals.elements += diagram.cells.length;
        totals.threats += threatCount;
        return {
            id: diagram.id,
            title: diagram.title,
            diagramType: diagram.diagramType,
            elementCount: diagram.cells.length,
            threatCount
        };
    });

    return { model, result: { diagrams, totals } };
};

export const ops = {
    createDiagram,
    addElement,
    connectFlow,
    addBoundary,
    addThreat,
    updateElement,
    removeElement,
    listThreats,
    validateModel: validateModelOp,
    getModelSummary
};
