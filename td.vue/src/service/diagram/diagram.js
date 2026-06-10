import graphFactory from '@/service/x6/graph/graph.js';
import events from '@/service/x6/graph/events.js';
import textWrap from '@/service/x6/text-wrap.js';
import { passiveSupport } from 'passive-events-support/src/utils';

const appVersion = require('../../../package.json').version;

passiveSupport({
    events: ['touchstart', 'mousewheel']
});

// Normalise trust boundaries on load so any imported / MCP-built / hand-edited
// model opens cleanly:
//  - repair the unregistered legacy shape 'trust-boundary' to the registered
//    edge shape 'trust-boundary-curve' (x6 only registers -box / -curve, and a
//    bare 'trust-boundary' makes fromJSON throw, breaking the whole editor);
//  - send boundaries behind other components (zIndex -1) so they never sit on
//    top and intercept clicks on the elements inside them;
//  - repair string label attrs from older generators: a bare string under
//    attrs.label replaces the shape's label attrs, which re-centers box labels
//    (they default to the top-left corner) — and edges only render names from
//    the labels API, so a curve's attrs.label string is moved there.
const normalizeBoundaries = (diagram) => {
    (diagram.cells || []).forEach((cell) => {
        if (cell.shape === 'trust-boundary') {
            cell.shape = 'trust-boundary-curve';
        }
        if (cell.shape === 'trust-boundary-box' || cell.shape === 'trust-boundary-curve') {
            cell.zIndex = -1;
            if (cell.attrs && typeof cell.attrs.label === 'string') {
                const text = cell.attrs.label;
                if (cell.shape === 'trust-boundary-curve') {
                    delete cell.attrs.label;
                    if (!Array.isArray(cell.labels) || cell.labels.length === 0) {
                        cell.labels = [{ position: 0.5, attrs: { label: { text } } }];
                    }
                } else {
                    cell.attrs.label = { text };
                }
            }
        }
    });
};

const drawGraph = (diagram, graph) => {
    console.debug('open diagram version: ' + diagram.version);
    diagram.version = appVersion;
    normalizeBoundaries(diagram);
    // fromJSON fires no per-cell events, so wrap node labels (display-only,
    // word-boundary; X6's built-in textWrap can't — see service/x6/text-wrap.js)
    // directly on the JSON before drawing.
    textWrap.normalizeModelLabels(diagram);
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
