import textWrap from '@/service/x6/text-wrap.js';

describe('service/x6/text-wrap.js', () => {
    describe('canWrap', () => {
        it('is true for actor, process and store', () => {
            expect(textWrap.canWrap({ type: 'tm.Actor' })).toBe(true);
            expect(textWrap.canWrap({ type: 'tm.Process' })).toBe(true);
            expect(textWrap.canWrap({ type: 'tm.Store' })).toBe(true);
        });

        it('is false for other types and missing data', () => {
            expect(textWrap.canWrap({ type: 'tm.Flow' })).toBe(false);
            expect(textWrap.canWrap({ type: 'tm.Boundary' })).toBe(false);
            expect(textWrap.canWrap({})).toBe(false);
            expect(textWrap.canWrap(undefined)).toBe(false);
        });
    });

    describe('isWrapEnabled (default ON)', () => {
        it('treats undefined wrapLabel as enabled', () => {
            expect(textWrap.isWrapEnabled({ type: 'tm.Process' })).toBe(true);
        });

        it('is enabled when wrapLabel is true', () => {
            expect(textWrap.isWrapEnabled({ wrapLabel: true })).toBe(true);
        });

        it('is disabled only when wrapLabel is explicitly false', () => {
            expect(textWrap.isWrapEnabled({ wrapLabel: false })).toBe(false);
        });
    });

    describe('wrapName', () => {
        // process @ width 100 => maxChars = floor((100 - 16) / 7) = 12

        it('packs words greedily, breaking only at spaces', () => {
            expect(textWrap.wrapName('REST API (Node/Express)', 'tm.Process', 100))
                .toEqual('REST API\n(Node/Express)');
        });

        it('does not wrap a label that already fits', () => {
            expect(textWrap.wrapName('Web server', 'tm.Process', 100)).toEqual('Web server');
        });

        it('never character-breaks a single long word (lets it overflow)', () => {
            expect(textWrap.wrapName('Supercalifragilistic', 'tm.Process', 100))
                .toEqual('Supercalifragilistic');
        });

        it('normalises runs of whitespace to single spaces', () => {
            expect(textWrap.wrapName('REST   API', 'tm.Process', 100)).toEqual('REST API');
        });

        it('uses a wider budget for larger shapes', () => {
            // store @ 150 => floor((150 - 12) / 7) = 19, so this fits on one line
            expect(textWrap.wrapName('Customer Records DB', 'tm.Store', 150))
                .toEqual('Customer Records DB');
        });

        it('returns empty string for empty input and preserves null/undefined', () => {
            expect(textWrap.wrapName('', 'tm.Process', 100)).toEqual('');
            expect(textWrap.wrapName(null, 'tm.Process', 100)).toBeNull();
            expect(textWrap.wrapName(undefined, 'tm.Process', 100)).toBeUndefined();
        });
    });

    describe('applyLabelWrap', () => {
        const makeCell = (data, width = 100) => ({
            getData: jest.fn(() => data),
            setAttrByPath: jest.fn(),
            size: jest.fn(() => ({ width, height: 80 }))
        });

        it('sets the wrapped display text from data.name when enabled (default ON)', () => {
            const cell = makeCell({ type: 'tm.Process', name: 'REST API (Node/Express)' }, 100);
            textWrap.applyLabelWrap(cell);
            expect(cell.setAttrByPath).toHaveBeenCalledWith('text/text', 'REST API\n(Node/Express)');
        });

        it('sets the single-line name when wrapping is disabled', () => {
            const cell = makeCell({ type: 'tm.Process', name: 'REST API (Node/Express)', wrapLabel: false }, 100);
            textWrap.applyLabelWrap(cell);
            expect(cell.setAttrByPath).toHaveBeenCalledWith('text/text', 'REST API (Node/Express)');
        });

        it('never mutates data.name', () => {
            const data = { type: 'tm.Process', name: 'REST API (Node/Express)' };
            textWrap.applyLabelWrap(makeCell(data, 100));
            expect(data.name).toEqual('REST API (Node/Express)');
        });

        it('does nothing for non-wrappable types', () => {
            const cell = makeCell({ type: 'tm.Flow', name: 'data' });
            textWrap.applyLabelWrap(cell);
            expect(cell.setAttrByPath).not.toHaveBeenCalled();
        });

        it('is a no-op for cells without the expected API', () => {
            expect(() => textWrap.applyLabelWrap(undefined)).not.toThrow();
            expect(() => textWrap.applyLabelWrap({})).not.toThrow();
        });
    });

    describe('normalizeModelLabels', () => {
        it('wraps the display text of wrappable cells using stored size', () => {
            const diagram = {
                cells: [{
                    shape: 'process',
                    size: { width: 100, height: 100 },
                    attrs: { text: { text: 'REST API (Node/Express)' } },
                    data: { type: 'tm.Process', name: 'REST API (Node/Express)' }
                }]
            };
            textWrap.normalizeModelLabels(diagram);
            expect(diagram.cells[0].attrs.text.text).toEqual('REST API\n(Node/Express)');
            expect(diagram.cells[0].data.name).toEqual('REST API (Node/Express)');
        });

        it('falls back to the per-type default width when size is absent', () => {
            const diagram = {
                cells: [{
                    shape: 'process',
                    data: { type: 'tm.Process', name: 'REST API (Node/Express)' }
                }]
            };
            textWrap.normalizeModelLabels(diagram);
            // default process width 100 => same wrap as above
            expect(diagram.cells[0].attrs.text.text).toEqual('REST API\n(Node/Express)');
        });

        it('skips cells with wrapping disabled', () => {
            const diagram = {
                cells: [{
                    shape: 'store',
                    size: { width: 60 },
                    attrs: { text: { text: 'A long store name here' } },
                    data: { type: 'tm.Store', name: 'A long store name here', wrapLabel: false }
                }]
            };
            textWrap.normalizeModelLabels(diagram);
            expect(diagram.cells[0].attrs.text.text).toEqual('A long store name here');
        });

        it('ignores non-wrappable cells and tolerates a missing cells array', () => {
            const diagram = { cells: [{ shape: 'flow', data: { type: 'tm.Flow', name: 'x' } }] };
            textWrap.normalizeModelLabels(diagram);
            expect(diagram.cells[0].attrs).toBeUndefined();
            expect(() => textWrap.normalizeModelLabels({})).not.toThrow();
        });
    });
});
