import zorder from '@/service/x6/zorder.js';

describe('service/x6/zorder.js', () => {
    let graph, cell;

    beforeEach(() => {
        graph = {
            startBatch: jest.fn(),
            stopBatch: jest.fn()
        };
        cell = {
            toFront: jest.fn(),
            toBack: jest.fn(),
            getZIndex: jest.fn().mockReturnValue(5),
            setZIndex: jest.fn()
        };
    });

    const expectBatched = () => {
        expect(graph.startBatch).toHaveBeenCalledWith('z-order');
        expect(graph.stopBatch).toHaveBeenCalledWith('z-order');
    };

    describe('toFront', () => {
        beforeEach(() => zorder.toFront(graph, cell));

        it('brings the cell to the front', () => {
            expect(cell.toFront).toHaveBeenCalledTimes(1);
        });

        it('wraps the change in a single history batch', () => {
            expectBatched();
        });
    });

    describe('toBack', () => {
        beforeEach(() => zorder.toBack(graph, cell));

        it('sends the cell to the back', () => {
            expect(cell.toBack).toHaveBeenCalledTimes(1);
        });

        it('wraps the change in a single history batch', () => {
            expectBatched();
        });
    });

    describe('forward', () => {
        beforeEach(() => zorder.forward(graph, cell));

        it('increments the z-index', () => {
            expect(cell.setZIndex).toHaveBeenCalledWith(6);
        });

        it('wraps the change in a single history batch', () => {
            expectBatched();
        });
    });

    describe('backward', () => {
        beforeEach(() => zorder.backward(graph, cell));

        it('decrements the z-index', () => {
            expect(cell.setZIndex).toHaveBeenCalledWith(4);
        });

        it('wraps the change in a single history batch', () => {
            expectBatched();
        });
    });
});
