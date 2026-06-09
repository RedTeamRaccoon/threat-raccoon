import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { createRequire } from 'node:module';

// Load the canonical v2 schema. JSON import assertions are still unstable across
// the consumer toolchains (webpack/jest/babel), so use createRequire for a plain
// synchronous read that works identically everywhere.
const require = createRequire(import.meta.url);
const schemaV2 = require('./schema/threat-dragon-v2.schema.json');

// Same options as td.vue/src/service/schema/ajv.js so validation cannot diverge.
const ajv = new Ajv({ allowUnionTypes: true });
addFormats(ajv);

const validateV2 = ajv.compile(schemaV2);

/**
 * Validate a Threat Dragon v2 model document.
 * @param {object} model
 * @returns {{ valid: boolean, errors: (object[]|null) }}
 */
export function validateModel(model) {
    const valid = validateV2(model);
    return { valid, errors: valid ? null : validateV2.errors };
}
