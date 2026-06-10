/**
 * @name tmcoreValidate
 * @description Browser-safe drop-in for shared/tmcore/validate.js. The tmcore
 * original reads the v2 schema via node:module createRequire, which cannot enter
 * the webpack bundle (or jsdom jest), so the build substitutes this shim (see
 * vue.config.js NormalModuleReplacementPlugin and jest.config.js moduleNameMapper).
 * It reuses the app's own AJV instance compiled with the SAME schema and options
 * (src/service/schema/ajv.js), so validation cannot diverge from tmcore's.
 */
import { checkV2 } from '@/service/schema/ajv.js';

/**
 * Validate a Threat Dragon v2 model document.
 * Same contract as shared/tmcore/validate.js validateModel.
 * @param {object} model
 * @returns {{ valid: boolean, errors: (object[]|null) }}
 */
export function validateModel(model) {
    const errors = checkV2(model);
    return { valid: !errors, errors: errors || null };
}
