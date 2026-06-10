import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ops, TmcoreError } from '../ops.js';
import { validateModel } from '../validate.js';
import { emptyModel } from './helpers.js';

test('full lifecycle: build a model with ops and validate end-to-end', () => {
    let model = emptyModel();

    // createDiagram
    let r = ops.createDiagram(model, { title: 'Main', diagramType: 'STRIDE' });
    model = r.model;
    assert.equal(r.result.diagramId, 0);
    assert.equal(model.detail.diagramTop, 1);
    const diagramId = r.result.diagramId;

    // addElement(process)
    r = ops.addElement(model, { diagramId, kind: 'process', name: 'Web App', position: { x: 100, y: 100 } });
    model = r.model;
    const processId = r.result.cellId;
    assert.ok(processId);

    // addElement(store)
    r = ops.addElement(model, { diagramId, kind: 'store', name: 'DB', position: { x: 300, y: 100 } });
    model = r.model;
    const storeId = r.result.cellId;

    // the process cell matches the default-properties template shape
    const processCell = model.detail.diagrams[0].cells.find((c) => c.id === processId);
    assert.equal(processCell.shape, 'process');
    assert.equal(processCell.data.type, 'tm.Process');
    assert.equal(processCell.data.name, 'Web App');
    assert.equal(processCell.attrs.text.text, 'Web App');
    assert.deepEqual(processCell.size, { width: 100, height: 100 });

    // connectFlow
    r = ops.connectFlow(model, { diagramId, sourceId: processId, targetId: storeId, name: 'SQL', protocol: 'SQL' });
    model = r.model;
    const flowId = r.result.cellId;
    const flowCell = model.detail.diagrams[0].cells.find((c) => c.id === flowId);
    assert.equal(flowCell.shape, 'flow');
    assert.equal(flowCell.source.cell, processId);
    assert.equal(flowCell.target.cell, storeId);
    assert.equal(flowCell.data.protocol, 'SQL');

    // connectFlow to a missing element throws
    assert.throws(
        () => ops.connectFlow(model, { diagramId, sourceId: processId, targetId: 'nope' }),
        TmcoreError
    );

    // addBoundary (box)
    r = ops.addBoundary(model, { diagramId, kind: 'box', name: 'Internal', position: { x: 50, y: 50 }, size: { width: 400, height: 300 } });
    model = r.model;
    const boundaryId = r.result.cellId;
    const boundaryCell = model.detail.diagrams[0].cells.find((c) => c.id === boundaryId);
    assert.equal(boundaryCell.shape, 'trust-boundary-box');
    assert.equal(boundaryCell.data.isTrustBoundary, true);
    // Boundary must sit BEHIND components (zIndex -1) or it intercepts clicks
    // on the elements inside it when the model is rendered (matches the
    // td.vue x6/graph/events.js runtime rule).
    assert.equal(boundaryCell.zIndex, -1);

    // addThreat — threatTop increments, hasOpenThreats flips
    assert.equal(model.detail.threatTop, 0);
    assert.equal(processCell.data.hasOpenThreats, false);
    r = ops.addThreat(model, { diagramId, cellId: processId, threat: { title: 'Spoof the app' } });
    model = r.model;
    assert.equal(r.result.number, 1);
    assert.equal(model.detail.threatTop, 1);
    const processAfter = model.detail.diagrams[0].cells.find((c) => c.id === processId);
    assert.equal(processAfter.data.hasOpenThreats, true);
    assert.equal(processAfter.data.threats.length, 1);
    // STRIDE default for a process is Spoofing
    assert.equal(processAfter.data.threats[0].type, 'Spoofing');
    assert.equal(processAfter.data.threats[0].number, 1);
    assert.equal(processAfter.data.threats[0].id, r.result.threatId);

    // a second threat increments threatTop again
    r = ops.addThreat(model, { diagramId, cellId: storeId, threat: {} });
    model = r.model;
    assert.equal(r.result.number, 2);
    assert.equal(model.detail.threatTop, 2);

    // listThreats returns both open threats
    r = ops.listThreats(model, {});
    assert.equal(r.result.threats.length, 2);

    // getModelSummary counts
    r = ops.getModelSummary(model, {});
    const summary = r.result;
    assert.equal(summary.diagrams.length, 1);
    assert.equal(summary.diagrams[0].elementCount, 4); // process, store, flow, boundary
    assert.equal(summary.diagrams[0].threatCount, 2);
    assert.equal(summary.totals.elements, 4);
    assert.equal(summary.totals.threats, 2);
    assert.equal(summary.totals.openThreats, 2);

    // updateElement renames and moves
    r = ops.updateElement(model, { diagramId, cellId: processId, patch: { name: 'Renamed', position: { x: 1, y: 2 } } });
    model = r.model;
    const renamed = model.detail.diagrams[0].cells.find((c) => c.id === processId);
    assert.equal(renamed.data.name, 'Renamed');
    assert.equal(renamed.attrs.text.text, 'Renamed');
    assert.deepEqual(renamed.position, { x: 1, y: 2 });

    // removeElement prunes referencing flows
    r = ops.removeElement(model, { diagramId, cellId: processId });
    model = r.model;
    assert.ok(r.result.removed.includes(processId));
    assert.ok(r.result.removed.includes(flowId)); // flow referenced the process
    const remainingIds = model.detail.diagrams[0].cells.map((c) => c.id);
    assert.ok(!remainingIds.includes(processId));
    assert.ok(!remainingIds.includes(flowId));

    // final model is schema-valid
    const { valid, errors } = validateModel(model);
    assert.equal(valid, true, JSON.stringify(errors, null, 2));
});

test('addBoundary curve uses the registered trust-boundary-curve edge shape, behind components', () => {
    let model = emptyModel();
    let r = ops.createDiagram(model, { title: 'Main', diagramType: 'STRIDE' });
    model = r.model;
    const diagramId = r.result.diagramId;
    r = ops.addBoundary(model, { diagramId, kind: 'curve', name: 'Net edge', source: { x: 150, y: -20 }, target: { x: 150, y: 220 } });
    model = r.model;
    const curve = model.detail.diagrams[0].cells.find((c) => c.id === r.result.cellId);
    assert.equal(curve.shape, 'trust-boundary-curve'); // registered x6 edge name (not bare 'trust-boundary')
    assert.equal(curve.data.type, 'tm.Boundary');
    assert.equal(curve.zIndex, -1); // sits behind components
    assert.equal(validateModel(model).valid, true);
});

test('ops never mutate their input model', () => {
    const model = emptyModel();
    const before = JSON.stringify(model);
    ops.createDiagram(model, { title: 'X', diagramType: 'STRIDE' });
    assert.equal(JSON.stringify(model), before);
});

test('operations on a missing diagram throw TmcoreError', () => {
    const model = emptyModel();
    assert.throws(
        () => ops.addElement(model, { diagramId: 99, kind: 'process', name: 'x', position: { x: 0, y: 0 } }),
        TmcoreError
    );
});

test('elements without a position land on distinct grid slots, never stacked', () => {
    let model = emptyModel();
    let r = ops.createDiagram(model, { title: 'Grid', diagramType: 'STRIDE' });
    model = r.model;
    const diagramId = r.result.diagramId;

    const positions = [];
    for (let i = 0; i < 6; i += 1) {
        r = ops.addElement(model, { diagramId, kind: 'process', name: `P${i}` });
        model = r.model;
        const cell = model.detail.diagrams[0].cells.find((c) => c.id === r.result.cellId);
        positions.push(cell.position);
    }

    // every slot is unique and generously separated
    for (let a = 0; a < positions.length; a += 1) {
        for (let b = a + 1; b < positions.length; b += 1) {
            const apart = Math.abs(positions[a].x - positions[b].x) >= 60 ||
                Math.abs(positions[a].y - positions[b].y) >= 60;
            assert.ok(apart, `elements ${a} and ${b} are stacked: ${JSON.stringify(positions[a])}`);
        }
    }
});

test('an explicit position on top of an existing component is nudged clear', () => {
    let model = emptyModel();
    let r = ops.createDiagram(model, { title: 'Nudge', diagramType: 'STRIDE' });
    model = r.model;
    const diagramId = r.result.diagramId;

    r = ops.addElement(model, { diagramId, kind: 'process', name: 'A', position: { x: 200, y: 200 } });
    model = r.model;

    // same spot: must move off it
    r = ops.addElement(model, { diagramId, kind: 'store', name: 'B', position: { x: 205, y: 195 } });
    model = r.model;
    const nudged = model.detail.diagrams[0].cells.find((c) => c.id === r.result.cellId);
    const apart = Math.abs(nudged.position.x - 200) >= 60 || Math.abs(nudged.position.y - 200) >= 60;
    assert.ok(apart, `still stacked at ${JSON.stringify(nudged.position)}`);

    // a clear explicit position is preserved exactly
    r = ops.addElement(model, { diagramId, kind: 'actor', name: 'C', position: { x: 700, y: 80 } });
    model = r.model;
    const exact = model.detail.diagrams[0].cells.find((c) => c.id === r.result.cellId);
    assert.deepEqual(exact.position, { x: 700, y: 80 });
});
