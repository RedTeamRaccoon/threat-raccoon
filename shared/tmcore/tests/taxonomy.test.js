import { test } from 'node:test';
import assert from 'node:assert/strict';

import taxonomy, { defaultCategory, normalizeModelType, createTypedThreat } from '../taxonomy.js';

test('STRIDE default category depends on cell type', () => {
    assert.equal(defaultCategory('STRIDE', 'tm.Actor').type, 'Spoofing');
    assert.equal(defaultCategory('STRIDE', 'tm.Process').type, 'Spoofing');
    assert.equal(defaultCategory('STRIDE', 'tm.Store').type, 'Tampering');
    assert.equal(defaultCategory('STRIDE', 'tm.Flow').type, 'Tampering');
});

test('CIA and LINDDUN defaults match original logic', () => {
    assert.equal(defaultCategory('CIA', 'tm.Process').type, 'Confidentiality');
    assert.equal(defaultCategory('LINDDUN', 'tm.Process').type, 'Linkability');
    assert.equal(defaultCategory('CIADIE', 'tm.Process').type, 'Distributed');
    assert.equal(defaultCategory('EOP', 'tm.Process').type, 'cornucopia');
    assert.equal(defaultCategory('PLOT4ai', 'tm.Actor').type, 'Accessibility');
    assert.equal(defaultCategory('PLOT4ai', 'tm.Process').type, 'Technique & Processes');
});

test('modelType normalization mirrors createNewTypedThreat', () => {
    assert.equal(normalizeModelType(undefined), 'STRIDE');
    assert.equal(normalizeModelType(''), 'STRIDE');
    assert.equal(normalizeModelType('generic'), 'default');
    assert.equal(normalizeModelType('DIE'), 'CIADIE');
    assert.equal(normalizeModelType('STRIDE'), 'STRIDE');
});

test('default (generic) modelType falls back to Spoofing', () => {
    assert.equal(defaultCategory('generic', 'tm.Store').type, 'Spoofing');
});

test('createTypedThreat applies defaults and honors overrides', () => {
    const t = createTypedThreat({ modelType: 'STRIDE', cellType: 'tm.Process', number: 5 });
    assert.equal(t.type, 'Spoofing');
    assert.equal(t.status, 'Open');
    assert.equal(t.severity, 'TBD');
    assert.equal(t.number, 5);
    assert.equal(t.modelType, 'STRIDE');
    assert.equal(t.score, '');
    assert.ok(typeof t.id === 'string' && t.id.length > 10);

    const o = createTypedThreat({
        modelType: 'STRIDE', cellType: 'tm.Process', number: 6,
        title: 'Custom', type: 'Tampering', severity: 'High', status: 'Mitigated'
    });
    assert.equal(o.title, 'Custom');
    assert.equal(o.type, 'Tampering');
    assert.equal(o.severity, 'High');
    assert.equal(o.status, 'Mitigated');
});

test('taxonomy default export exposes the helpers', () => {
    assert.equal(typeof taxonomy.createTypedThreat, 'function');
    assert.equal(typeof taxonomy.defaultCategory, 'function');
    assert.ok(Array.isArray(taxonomy.categoriesByModelType.STRIDE));
});
