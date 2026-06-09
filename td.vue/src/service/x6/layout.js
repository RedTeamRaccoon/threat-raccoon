/**
 * @name layout
 * @description Layered auto-arrange for diagram cells using Dagre.
 *
 * Trust boundaries are NOT modelled by Dagre (it has no concept of containers),
 * so they are excluded from the layout. After the components are arranged each
 * trust-boundary BOX is grown to keep enclosing the same components it held
 * before the re-layout. Only positions/sizes change; cell data is preserved.
 */
import { DagreLayout } from '@antv/layout';

// shapes that represent trust boundaries (the historic 'broundary' typo included)
const BOUNDARY_SHAPES = ['trust-boundary-box', 'trust-boundary-curve', 'trust-broundary-curve'];

const isBoundary = (cell) => BOUNDARY_SHAPES.includes(cell.shape);
const isBoundaryBox = (cell) => cell.shape === 'trust-boundary-box';

// padding (px) kept between a boundary box edge and the components it encloses
const BOUNDARY_PADDING = 30;

const centerInside = (node, box) => {
    const bbox = node.getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    return cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height;
};

const fitBoundaryTo = (boundary, members) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    members.forEach((node) => {
        const b = node.getBBox();
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
    });
    boundary.position(minX - BOUNDARY_PADDING, minY - BOUNDARY_PADDING);
    boundary.resize(
        maxX - minX + BOUNDARY_PADDING * 2,
        maxY - minY + BOUNDARY_PADDING * 2
    );
};

/**
 * Auto-arrange the diagram. Returns true when a layout was applied.
 * @param {object} graph the X6 graph
 */
const autoLayout = (graph) => {
    const cells = graph.getCells();
    const nodes = cells.filter((c) => c.isNode() && !isBoundary(c));
    const edges = cells.filter((c) => c.isEdge() && !isBoundary(c));

    if (nodes.length === 0) {
        return false;
    }

    // remember which components each boundary box currently encloses, using the
    // pre-layout geometry, so the box can be re-fitted around them afterwards
    const boundaryBoxes = cells.filter(isBoundaryBox);
    const membership = boundaryBoxes.map((boundary) => ({
        boundary,
        members: nodes.filter((node) => centerInside(node, boundary.getBBox()))
    }));

    const model = {
        nodes: nodes.map((node) => {
            const size = node.size();
            return { id: node.id, size: [size.width, size.height] };
        }),
        edges: edges
            .map((edge) => ({ source: edge.getSourceCellId(), target: edge.getTargetCellId() }))
            .filter((edge) => edge.source && edge.target)
    };

    const result = new DagreLayout({
        type: 'dagre',
        rankdir: 'LR',
        nodesep: 40,
        ranksep: 80
    }).layout(model);

    graph.startBatch('auto-layout');
    try {
        result.nodes.forEach((laidOut) => {
            const cell = graph.getCellById(laidOut.id);
            if (cell) {
                const size = cell.size();
                // Dagre returns the node centre; X6 positions by the top-left corner
                cell.position(laidOut.x - size.width / 2, laidOut.y - size.height / 2);
            }
        });
        membership.forEach(({ boundary, members }) => {
            if (members.length > 0) {
                fitBoundaryTo(boundary, members);
            }
        });
    } finally {
        graph.stopBatch('auto-layout');
    }

    return true;
};

export default {
    autoLayout
};
