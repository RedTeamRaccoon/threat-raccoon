/**
 * @name editorContext.helper
 * @description Tracks which threat model / diagram the user currently has open
 * in the browser editor. The context is kept in memory (for the HTTP server)
 * and best-effort persisted to a small state file so the stdio MCP entrypoint
 * (a separate process) can read it too.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import loggerHelper from './logger.helper.js';

const logger = loggerHelper.get('helpers/editorContext.helper.js');

// In-memory context for the running server process.
let current = null;

/**
 * Resolves the state-file path. TD_EDITOR_CONTEXT_FILE overrides the default
 * (read directly from process.env so tests can point it at a temp file).
 * @returns {String}
 */
const getStateFilePath = () => process.env.TD_EDITOR_CONTEXT_FILE ||
    path.join(os.homedir(), '.threat-dragon', 'editor-context.json');

/**
 * Whitelist-sanitizes a reported context. Returns null when nothing usable
 * was reported (treated as "clear").
 * @param {Object} context
 * @returns {Object|null}
 */
const sanitize = (context) => {
    if (!context || typeof context !== 'object') {
        return null;
    }
    const sanitized = {};
    ['page', 'modelTitle', 'diagramTitle'].forEach((field) => {
        if (typeof context[field] === 'string') {
            sanitized[field] = context[field];
        }
    });
    if (typeof context.diagramId === 'number' || typeof context.diagramId === 'string') {
        sanitized.diagramId = context.diagramId;
    }
    if (Object.keys(sanitized).length === 0) {
        return null;
    }
    return sanitized;
};

/**
 * Best-effort persistence: never throws on filesystem errors.
 * @param {Object|null} value
 */
const persist = (value) => {
    const filePath = getStateFilePath();
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
    } catch (e) {
        logger.debug(`Could not persist editor context to ${filePath}: ${e.message}`);
    }
};

/**
 * Stores the reported editor context (or clears it when null/empty).
 * @param {Object|null} context
 * @returns {Object|null} the stored context
 */
const set = (context) => {
    const sanitized = sanitize(context);
    current = sanitized === null ? null : { ...sanitized, updatedAt: new Date().toISOString() };
    persist(current);
    return current;
};

/**
 * @returns {Object|null} the in-memory context
 */
const get = () => current;

/**
 * Reads the persisted context from the state file. Used by the stdio MCP
 * entrypoint, which runs in a separate process and does not share memory
 * with the HTTP server.
 * @returns {Object|null} null on any read/parse error
 */
const readFromFile = () => {
    try {
        return JSON.parse(fs.readFileSync(getStateFilePath(), 'utf8'));
    } catch (e) {
        return null;
    }
};

export default { set, get, readFromFile, getStateFilePath };
