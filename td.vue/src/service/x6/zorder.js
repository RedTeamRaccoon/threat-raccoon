/**
 * @name zorder
 * @description Z-order (stacking) operations for diagram cells. Each operation
 * is wrapped in a single history batch so it undoes/redoes in one step.
 */

const inBatch = (graph, fn) => {
    graph.startBatch('z-order');
    try {
        fn();
    } finally {
        graph.stopBatch('z-order');
    }
};

const toFront = (graph, cell) => inBatch(graph, () => cell.toFront());

const toBack = (graph, cell) => inBatch(graph, () => cell.toBack());

const forward = (graph, cell) => inBatch(graph, () => cell.setZIndex(cell.getZIndex() + 1));

const backward = (graph, cell) => inBatch(graph, () => cell.setZIndex(cell.getZIndex() - 1));

export default {
    toFront,
    toBack,
    forward,
    backward
};
