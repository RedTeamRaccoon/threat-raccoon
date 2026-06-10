/**
 * @name editorcontextcontroller
 * @description Receives "which threat model / diagram is open" reports from the
 * browser editor and stores them via the editor-context helper so the MCP
 * transports can expose the context to external agents.
 */
import editorContext from '../helpers/editorContext.helper.js';
import loggerHelper from '../helpers/logger.helper.js';
import responseWrapper from './responseWrapper.js';

const logger = loggerHelper.get('controllers/editorcontextcontroller.js');

const update = (req, res) => responseWrapper.sendResponse(
    () => editorContext.set(req.body || null),
    req,
    res,
    logger
);

export default { update };
