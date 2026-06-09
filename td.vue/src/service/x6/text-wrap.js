/**
 * @name text-wrap
 * @description Display-only auto word-wrap for node labels. X6's built-in
 * `attrs.text.textWrap` cannot help here: x6-common `breakText` wraps purely by
 * character count and the `breakWord` option is disabled in @antv/x6@2.19.2, so
 * it splits words mid-character. Instead we compute the wrapping ourselves and
 * insert real `\n` into the DISPLAY text (`attrs.text.text`) — X6 renders each
 * `\n`-delimited segment as its own <tspan> line and never splits a word.
 *
 * The stored `data.name` is the single source of truth and is NEVER mutated
 * (reports, exports and threats use it). Wrapping is always recomputed FROM
 * `data.name`, so it is idempotent. Controlled per cell by `data.wrapLabel`,
 * which defaults ON: only an explicit `false` disables it, so models saved
 * before this feature still wrap on load.
 */

// Node types whose label can wrap, with the horizontal padding (px) kept clear
// of the shape edge, and a fallback width for the load path when a stored cell
// has no explicit size.
const paddingByType = {
    'tm.Actor': 12,
    'tm.Process': 16,
    'tm.Store': 12
};

const defaultWidthByType = {
    'tm.Actor': 150,
    'tm.Process': 100,
    'tm.Store': 150
};

// Rough average glyph advance (px) for the label font. The wrap is a heuristic;
// pixel-perfect line breaking is not needed.
const AVG_CHAR_PX = 7;

const canWrap = (data) => !!data && Object.prototype.hasOwnProperty.call(paddingByType, data.type);

// Default ON: only an explicit `false` disables wrapping.
const isWrapEnabled = (data) => !!data && data.wrapLabel !== false;

// Per-line character budget derived from the usable shape width. Floored at 6
// so very small/odd sizes still produce a sane budget.
const maxCharsFor = (type, width) => {
    const usable = (width || defaultWidthByType[type] || 0) - (paddingByType[type] || 0);
    return Math.max(6, Math.floor(usable / AVG_CHAR_PX));
};

/**
 * Greedy word-pack `name` into lines separated by `\n` so each line fits the
 * character budget for `type` at `width`. Whitespace is normalised to single
 * spaces first. A single word longer than the budget gets its own line and is
 * allowed to overflow (cleaner than a mid-word character break). Pure function.
 */
const wrapName = (name, type, width) => {
    if (name == null) {
        return name;
    }
    const words = String(name).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return '';
    }

    const maxChars = maxCharsFor(type, width);
    const lines = [];
    let line = '';

    words.forEach((word) => {
        if (line === '') {
            line = word;
        } else if (line.length + 1 + word.length <= maxChars) {
            line += ' ' + word;
        } else {
            lines.push(line);
            line = word;
        }
    });
    lines.push(line);

    return lines.join('\n');
};

/**
 * Runtime apply for a live cell: set the display text from `data.name`,
 * wrapped (when enabled) or single-line (when disabled). No-op for cells that
 * do not support wrapping or lack the X6 cell API. Called from the cell
 * style-update path (create, select, name-edit, toggle).
 */
const applyLabelWrap = (cell) => {
    if (!cell || typeof cell.getData !== 'function' || typeof cell.setAttrByPath !== 'function') {
        return;
    }
    const data = cell.getData();
    if (!canWrap(data)) {
        return;
    }
    const name = data.name == null ? '' : String(data.name);
    const text = isWrapEnabled(data)
        ? wrapName(name, data.type, typeof cell.size === 'function' ? cell.size().width : undefined)
        : name;
    cell.setAttrByPath('text/text', text);
};

/**
 * Load-path normalisation: `graph.fromJSON` emits no per-cell events, so wrap
 * the display text of every wrappable cell directly on the plain JSON diagram
 * before it is drawn. Derives width from each cell's stored `size.width`
 * (falling back to the per-type default). Mutates and returns the diagram.
 * Leaves `data.name` untouched and skips cells with wrapping disabled.
 */
const normalizeModelLabels = (diagram) => {
    if (!diagram || !Array.isArray(diagram.cells)) {
        return diagram;
    }
    diagram.cells.forEach((cell) => {
        const data = cell && cell.data;
        if (!canWrap(data) || !isWrapEnabled(data) || data.name == null) {
            return;
        }
        const width = (cell.size && cell.size.width) || defaultWidthByType[data.type];
        const wrapped = wrapName(String(data.name), data.type, width);
        if (!cell.attrs) {
            cell.attrs = {};
        }
        if (!cell.attrs.text) {
            cell.attrs.text = {};
        }
        cell.attrs.text.text = wrapped;
    });
    return diagram;
};

export default {
    wrapName,
    applyLabelWrap,
    normalizeModelLabels,
    isWrapEnabled,
    canWrap
};
