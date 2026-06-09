import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => JSON.parse(readFileSync(
    fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

test('tmcore schema is identical to the td.vue canonical schema (no drift)', () => {
    const mine = read('../schema/threat-dragon-v2.schema.json');
    const canonical = read('../../../td.vue/src/assets/schema/threat-dragon-v2.schema.json');
    assert.deepStrictEqual(mine, canonical);
});
