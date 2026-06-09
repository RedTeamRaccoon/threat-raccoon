import { createBinding } from '@/service/assistant/browserBinding.js';
import { createNewTypedThreat } from '@/service/threats/index.js';
import { checkV2 } from '@/service/schema/ajv.js';
import { THREATMODEL_UPDATE, THREATMODEL_MODIFIED } from '@/store/actions/threatmodel.js';

jest.mock('@/service/x6/graph/data-changed.js', () => ({
    __esModule: true,
    default: { updateStyleAttrs: jest.fn(), updateName: jest.fn() }
}));

jest.mock('@/service/threats/index.js', () => ({
    __esModule: true,
    createNewTypedThreat: jest.fn(() => ({
        id: 'threat-1',
        status: 'Open',
        severity: 'TBD',
        title: 'Generated threat',
        type: 'Spoofing',
        number: 0
    })),
    default: {}
}));

jest.mock('@/service/x6/shapes/index.js', () => {
    function Flow(cfg) {
        this.cfg = cfg;
        this.id = 'flow-1';
        this.data = cfg.data;
        this.setName = jest.fn();
    }
    function TrustBoundaryCurve(cfg) {
        this.cfg = cfg;
        this.id = 'curve-1';
        this.data = cfg.data;
        this.setName = jest.fn();
    }
    return { __esModule: true, default: { Flow, TrustBoundaryCurve } };
});

jest.mock('@/service/schema/ajv.js', () => ({
    __esModule: true,
    checkV2: jest.fn(() => null)
}));

const makeCell = (meta) => ({
    ...meta,
    id: meta.id || 'auto-id',
    _data: JSON.parse(JSON.stringify(meta.data || {})),
    isNode: () => true,
    getData() { return this._data; },
    setData(data) { this._data = data; },
    setName: jest.fn(),
    position: jest.fn(),
    resize: jest.fn(),
    updateStyle: jest.fn(),
    remove: jest.fn()
});

const makeGraph = () => {
    const nodes = [];
    const edges = [];
    const byId = {};
    return {
        nodes,
        edges,
        byId,
        startBatch: jest.fn(),
        stopBatch: jest.fn(),
        getNodes: () => nodes,
        getEdges: () => edges,
        getCellById: (id) => byId[id] || null,
        addNode: jest.fn(function (meta) {
            const cell = makeCell(meta);
            nodes.push(cell);
            byId[cell.id] = cell;
            return cell;
        }),
        addEdge: jest.fn(function (edge) {
            edges.push(edge);
            byId[edge.id] = edge;
            return edge;
        })
    };
};

const makeStore = (overrides = {}) => ({
    state: {
        threatmodel: {
            selectedDiagram: { id: 1, diagramType: 'STRIDE' },
            data: { detail: { threatTop: 5, diagrams: [] } }
        },
        cell: { ref: null }
    },
    dispatch: jest.fn(),
    ...overrides
});

describe('service/assistant/browserBinding', () => {
    let graph;
    let store;
    let binding;

    beforeEach(() => {
        // resetMocks:true clears inline mock implementations before each test
        createNewTypedThreat.mockImplementation(() => ({
            id: 'threat-1',
            status: 'Open',
            severity: 'TBD',
            title: 'Generated threat',
            type: 'Spoofing',
            number: 0
        }));
        checkV2.mockImplementation(() => null);
        graph = makeGraph();
        store = makeStore();
        binding = createBinding(graph, store);
    });

    describe('addElement', () => {
        it('adds a process node with the given name and position, batched', async () => {
            const res = await binding.execute('addElement', {
                kind: 'process',
                name: 'Web Server',
                position: { x: 120, y: 240 }
            });

            expect(res.ok).toBe(true);
            expect(graph.startBatch).toHaveBeenCalledWith('assistant-add-element');
            expect(graph.stopBatch).toHaveBeenCalledWith('assistant-add-element');
            expect(graph.addNode).toHaveBeenCalledTimes(1);

            const meta = graph.addNode.mock.calls[0][0];
            expect(meta.shape).toBe('process');
            expect(meta.data.name).toBe('Web Server');
            expect(meta.position).toEqual({ x: 120, y: 240 });
            expect(res.result.cellId).toBe(meta.id);
        });

        it('returns a structured error for an unknown kind', async () => {
            const res = await binding.execute('addElement', { kind: 'banana', name: 'x' });
            expect(res.ok).toBe(false);
            expect(res.error).toMatch(/Unknown element kind/);
            expect(graph.addNode).not.toHaveBeenCalled();
        });
    });

    describe('connectFlow', () => {
        it('connects two existing cells with a flow', async () => {
            await binding.execute('addElement', { kind: 'actor', name: 'User', position: { x: 0, y: 0 } });
            await binding.execute('addElement', { kind: 'process', name: 'API', position: { x: 200, y: 0 } });
            const [source, target] = graph.nodes;

            const res = await binding.execute('connectFlow', {
                sourceId: source.id,
                targetId: target.id,
                name: 'request',
                protocol: 'HTTPS'
            });

            expect(res.ok).toBe(true);
            expect(graph.addEdge).toHaveBeenCalledTimes(1);
            const edge = graph.addEdge.mock.calls[0][0];
            expect(edge.cfg.source).toEqual({ cell: source.id });
            expect(edge.cfg.target).toEqual({ cell: target.id });
            expect(edge.data.name).toBe('request');
            expect(edge.data.protocol).toBe('HTTPS');
            expect(res.result.cellId).toBe('flow-1');
        });

        it('errors when an endpoint does not exist', async () => {
            const res = await binding.execute('connectFlow', { sourceId: 'nope', targetId: 'nope2' });
            expect(res.ok).toBe(false);
            expect(res.error).toMatch(/No element found/);
        });
    });

    describe('addThreat', () => {
        it('appends a threat and bumps threatTop', async () => {
            await binding.execute('addElement', { kind: 'process', name: 'API', position: { x: 0, y: 0 } });
            const cell = graph.nodes[0];

            const res = await binding.execute('addThreat', {
                cellId: cell.id,
                threat: { severity: 'High', title: 'SQLi' }
            });

            expect(res.ok).toBe(true);
            expect(res.result).toEqual({ threatId: 'threat-1', number: 6 });
            expect(cell.getData().threats).toHaveLength(1);
            expect(cell.getData().threats[0].severity).toBe('High');
            expect(cell.getData().hasOpenThreats).toBe(true);
            expect(store.dispatch).toHaveBeenCalledWith(THREATMODEL_UPDATE, { threatTop: 6 });
            expect(store.dispatch).toHaveBeenCalledWith(THREATMODEL_MODIFIED);
        });
    });

    describe('removeElement', () => {
        it('removes the cell and prunes connected flows', async () => {
            await binding.execute('addElement', { kind: 'process', name: 'A', position: { x: 0, y: 0 } });
            const cell = graph.nodes[0];
            const edge = {
                id: 'edge-1',
                getSourceCellId: () => cell.id,
                getTargetCellId: () => 'other',
                remove: jest.fn()
            };
            graph.edges.push(edge);

            const res = await binding.execute('removeElement', { cellId: cell.id });

            expect(res.ok).toBe(true);
            expect(res.result.removed).toEqual([cell.id, 'edge-1']);
            expect(edge.remove).toHaveBeenCalled();
            expect(cell.remove).toHaveBeenCalled();
        });
    });

    describe('getModelSummary', () => {
        it('summarises diagrams and totals from the model snapshot', async () => {
            store.state.threatmodel.selectedDiagram = { id: 999 }; // not in diagrams -> use store data as-is
            store.state.threatmodel.data.detail.diagrams = [{
                id: 1,
                title: 'Main',
                diagramType: 'STRIDE',
                cells: [
                    { id: 'a', data: { name: 'A', threats: [{ status: 'Open', severity: 'High' }] } },
                    { id: 'b', data: { name: 'B', threats: [] } }
                ]
            }];

            const res = await binding.execute('getModelSummary', {});
            expect(res.ok).toBe(true);
            expect(res.result.diagrams[0]).toMatchObject({ id: 1, elementCount: 2, threatCount: 1 });
            expect(res.result.totals).toMatchObject({ elements: 2, threats: 1, openThreats: 1 });
            expect(res.result.totals.bySeverity.High).toBe(1);
        });
    });

    describe('validateModel', () => {
        it('delegates to the shared validator', async () => {
            store.state.threatmodel.selectedDiagram = { id: 999 };
            const res = await binding.execute('validateModel', {});
            expect(res.ok).toBe(true);
            expect(res.result).toEqual({ valid: true, errors: null });
        });
    });

    it('returns a structured error for an unknown operation', async () => {
        const res = await binding.execute('frobnicate', {});
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Unknown operation/);
    });
});
