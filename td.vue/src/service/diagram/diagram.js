import graphFactory from '@/service/x6/graph/graph.js';
import events from '@/service/x6/graph/events.js';
import { passiveSupport } from 'passive-events-support/src/utils';

const appVersion = require('../../../package.json').version;

passiveSupport({
    events: ['touchstart', 'mousewheel']
});

// Trust boundaries must render BEHIND other components, otherwise their shape
// sits on top and intercepts pointer events on the elements inside them. The
// canvas enforces this on draw (x6/graph/events.js), but imported/MCP-built
// models can carry any stored zIndex — so normalise on load here too, making
// "boundaries never block clicks" an invariant for every model TD opens.
const sendBoundariesToBack = (diagram) => {
    (diagram.cells || []).forEach((cell) => {
        if (cell.shape === 'trust-boundary-box' || cell.shape === 'trust-boundary-curve') {
            cell.zIndex = -1;
        }
    });
};

const drawGraph = (diagram, graph) => {
    console.debug('open diagram version: ' + diagram.version);
    diagram.version = appVersion;
    sendBoundariesToBack(diagram);
    graph.fromJSON(diagram);
    return graph;
};

const draw = (container, diagram) => drawGraph(diagram, graphFactory.getReadonlyGraph(container));
const edit = (container, diagram) => drawGraph(diagram, graphFactory.getEditGraph(container));

const dispose = (graph) => {
    events.removeListeners(graph);
    graph.dispose();
};

export default {
    dispose,
    draw,
    edit
};
