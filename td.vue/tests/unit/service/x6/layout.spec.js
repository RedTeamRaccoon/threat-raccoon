import layout from '@/service/x6/layout.js';

describe('service/x6/layout.js', () => {
    const makeNode = (id, shape, x, y, w = 100, h = 60) => {
        let pos = { x, y };
        let size = { width: w, height: h };
        return {
            id,
            shape,
            data: { name: id, type: 'tm.Process' },
            isNode: () => true,
            isEdge: () => false,
            size: () => size,
            getBBox: () => ({ x: pos.x, y: pos.y, width: size.width, height: size.height }),
            position: jest.fn((nx, ny) => { pos = { x: nx, y: ny }; }),
            resize: jest.fn((nw, nh) => { size = { width: nw, height: nh }; })
        };
    };

    const makeEdge = (id, source, target) => ({
        id,
        shape: 'flow',
        isNode: () => false,
        isEdge: () => true,
        getSourceCellId: () => source,
        getTargetCellId: () => target
    });

    const makeGraph = (cells) => ({
        getCells: () => cells,
        getCellById: (id) => cells.find((c) => c.id === id),
        startBatch: jest.fn(),
        stopBatch: jest.fn()
    });

    describe('autoLayout', () => {
        let nodeA, nodeB, edge, graph, result;

        beforeEach(() => {
            nodeA = makeNode('a', 'process', 0, 0);
            nodeB = makeNode('b', 'process', 0, 0);
            edge = makeEdge('e1', 'a', 'b');
            graph = makeGraph([nodeA, nodeB, edge]);
            result = layout.autoLayout(graph);
        });

        it('returns true when a layout was applied', () => {
            expect(result).toBe(true);
        });

        it('repositions every component node', () => {
            expect(nodeA.position).toHaveBeenCalled();
            expect(nodeB.position).toHaveBeenCalled();
        });

        it('arranges connected nodes left-to-right (different x)', () => {
            const ax = nodeA.position.mock.calls[0][0];
            const bx = nodeB.position.mock.calls[0][0];
            expect(ax).not.toEqual(bx);
        });

        it('runs inside a single history batch', () => {
            expect(graph.startBatch).toHaveBeenCalledWith('auto-layout');
            expect(graph.stopBatch).toHaveBeenCalledWith('auto-layout');
        });

        it('preserves cell data', () => {
            expect(nodeA.data).toEqual({ name: 'a', type: 'tm.Process' });
        });
    });

    describe('trust boundaries', () => {
        it('does not feed boundary cells to the layout but refits the box', () => {
            const nodeA = makeNode('a', 'process', 10, 10);
            const nodeB = makeNode('b', 'process', 10, 200);
            const edge = makeEdge('e1', 'a', 'b');
            // boundary box originally enclosing both nodes
            const boundary = makeNode('bound', 'trust-boundary-box', -20, -20, 300, 400);
            const graph = makeGraph([nodeA, nodeB, edge, boundary]);

            const res = layout.autoLayout(graph);

            expect(res).toBe(true);
            // the boundary was never positioned by Dagre, only re-fitted afterwards
            expect(boundary.position).toHaveBeenCalledTimes(1);
            expect(boundary.resize).toHaveBeenCalledTimes(1);
        });

        it('returns false when there are no component nodes to arrange', () => {
            const boundary = makeNode('bound', 'trust-boundary-box', 0, 0, 300, 300);
            const graph = makeGraph([boundary]);

            expect(layout.autoLayout(graph)).toBe(false);
            expect(graph.startBatch).not.toHaveBeenCalled();
        });
    });
});
