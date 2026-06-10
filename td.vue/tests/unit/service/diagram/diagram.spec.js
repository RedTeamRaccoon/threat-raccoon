import diagram from '@/service/diagram/diagram.js';
import events from '@/service/x6/graph/events.js';
import dataChanged from '@/service/x6/graph/data-changed.js';
import graphFactory from '@/service/x6/graph/graph.js';
import store from '@/store/index.js';

describe('service/diagram/diagram.js', () => {
    let diagramMock, graphMock, storeMock;
    const cellsMock = [ 'cell1' ];

    beforeEach(() => {
        diagramMock = {
            title: 'Test',
            description: 'Description',
            thumbnail: 'foo.png',
            id: '12345',
            diagramType: 'STRIDE',
            legacyField: true,
            version: '2.x'
        };
        graphMock = {
            fromJSON: jest.fn(),
            toJSON: jest.fn().mockReturnValue(diagramMock),
            addNode: jest.fn(),
            addEdge: jest.fn(),
            getCells: jest.fn().mockReturnValue(cellsMock),
            startBatch: jest.fn(),
            stopBatch: jest.fn(),
            dispose: jest.fn()
        };
        storeMock = { dispatch: jest.fn() };
        graphFactory.getReadonlyGraph = jest.fn().mockReturnValue(graphMock);
        graphFactory.getEditGraph = jest.fn().mockReturnValue(graphMock);
        dataChanged.updateStyleAttrs = jest.fn();
        store.get = jest.fn().mockReturnValue(storeMock);
    });

    describe('draw', () => {
        it('gets the graph json', () => {
            diagram.draw(null, diagramMock);
            expect(graphMock.fromJSON).toHaveBeenCalledTimes(1);
        });
    });

    describe('edit', () => {
        it('gets the edit graph', () => {
            diagram.edit(null, diagramMock);
            expect(graphFactory.getEditGraph).toHaveBeenCalledWith(null);
        });
    });

    describe('boundary z-order normalisation', () => {
        it('sends trust boundaries to the back (zIndex -1) on load so they cannot block clicks', () => {
            const withBoundaries = {
                ...diagramMock,
                cells: [
                    { id: 'a', shape: 'process', zIndex: 0 },
                    { id: 'b', shape: 'trust-boundary-box', zIndex: 10 },
                    { id: 'c', shape: 'trust-boundary-curve', zIndex: 10 }
                ]
            };
            diagram.edit(null, withBoundaries);
            expect(withBoundaries.cells.find((c) => c.id === 'b').zIndex).toBe(-1);
            expect(withBoundaries.cells.find((c) => c.id === 'c').zIndex).toBe(-1);
            expect(withBoundaries.cells.find((c) => c.id === 'a').zIndex).toBe(0);
        });

        it('repairs the unregistered legacy "trust-boundary" shape so fromJSON does not throw', () => {
            const withLegacy = {
                ...diagramMock,
                cells: [
                    { id: 'a', shape: 'process', zIndex: 0 },
                    { id: 'b', shape: 'trust-boundary', zIndex: 10, source: { x: 0, y: 0 }, target: { x: 0, y: 100 } }
                ]
            };
            diagram.edit(null, withLegacy);
            const repaired = withLegacy.cells.find((c) => c.id === 'b');
            expect(repaired.shape).toBe('trust-boundary-curve');
            expect(repaired.zIndex).toBe(-1);
        });

        it('repairs string label attrs so box labels keep their top-left placement', () => {
            const withStringLabels = {
                ...diagramMock,
                cells: [
                    { id: 'box', shape: 'trust-boundary-box', attrs: { label: 'Internal Network' } },
                    { id: 'curve', shape: 'trust-boundary-curve', attrs: { label: 'Internet Edge' }, source: { x: 0, y: 0 }, target: { x: 0, y: 100 } }
                ]
            };
            diagram.edit(null, withStringLabels);

            const box = withStringLabels.cells.find((c) => c.id === 'box');
            // an object MERGES with the shape's top-left label attrs; the bare
            // string replaced them, which re-centered the label
            expect(box.attrs.label).toEqual({ text: 'Internal Network' });

            const curve = withStringLabels.cells.find((c) => c.id === 'curve');
            // edges only render names from the labels API
            expect(curve.attrs.label).toBeUndefined();
            expect(curve.labels).toEqual([{ position: 0.5, attrs: { label: { text: 'Internet Edge' } } }]);
        });
    });

    describe('dispose', () => {
        beforeEach(() => {
            events.removeListeners = jest.fn();
            diagram.dispose(graphMock);
        });

        it('removes event listeners', () => {
            expect(events.removeListeners).toHaveBeenCalled();
        });

        it('disposes the graph', () => {
            expect(graphMock.dispose).toHaveBeenCalled();
        });
    });
});
