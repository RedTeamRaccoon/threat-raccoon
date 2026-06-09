import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validateModel } from '../validate.js';

const exampleModel = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../../td.vue/tests/e2e/fixtures/v2-model.json', import.meta.url)),
    'utf8'
));

test('a real v2 example model passes validation', () => {
    const { valid, errors } = validateModel(exampleModel);
    assert.equal(valid, true, JSON.stringify(errors, null, 2));
    assert.equal(errors, null);
});

test('a broken model fails with errors', () => {
    const broken = JSON.parse(JSON.stringify(exampleModel));
    delete broken.detail.diagrams; // detail.diagrams is required
    const { valid, errors } = validateModel(broken);
    assert.equal(valid, false);
    assert.ok(Array.isArray(errors) && errors.length > 0);
});

test('a non-object / missing top-level fields fails', () => {
    const { valid, errors } = validateModel({ version: '2.0' });
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
});
