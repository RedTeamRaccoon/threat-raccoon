import path from 'path';
import { pathToFileURL } from 'url';

/**
 * @name loadTmcore
 * @description Loads the shared operations core (`shared/tmcore`) at runtime.
 *
 * `shared/tmcore` is an ESM package (`"type": "module"`, uses `import.meta`) that
 * lives OUTSIDE `td.server/src`. We deliberately do NOT transpile it into `dist`
 * (babel would emit broken CJS — `import.meta` is invalid in CommonJS). Instead it
 * is loaded as native ESM.
 *
 * Both layouts resolve to repo-root/shared/tmcore via the same relative path:
 *   - dev (babel-node): src/mcp -> ../../../shared/tmcore
 *   - prod (dist):      dist/mcp -> ../../../shared/tmcore
 *
 * The import is wrapped in `new Function` so babel does not rewrite it to a
 * `require()` call (which cannot load ESM); the specifier is an absolute file URL
 * because a `new Function` body has no module base for relative resolution.
 */
const TMCORE_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'tmcore', 'index.js');

// eslint-disable-next-line no-new-func
const nativeImport = new Function('specifier', 'return import(specifier);');

export const loadTmcore = () => nativeImport(pathToFileURL(TMCORE_PATH).href);

export default { loadTmcore };
