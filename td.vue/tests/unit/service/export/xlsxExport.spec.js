import { modelToRows } from '@/service/export/xlsxExport.js';

/**
 * Tests for the PURE mapping function modelToRows.
 * The async exportXlsx function (which calls exceljs + DOM) is NOT tested here
 * because it requires a browser environment and a real/mocked exceljs workbook;
 * the mapping logic is the requirement-critical piece.
 */
describe('service/export/xlsxExport.js', () => {
    // Helpers
    const makeThreat = (overrides = {}) => ({
        id: 'uuid-1234',
        number: 1,
        title: 'SQL Injection',
        type: 'Tampering',
        description: 'An attacker can inject SQL.',
        severity: 'High',
        status: 'Open',
        ...overrides,
    });

    const makeNodeCell = (name, threats = []) => ({
        data: {
            name,
            type: 'tm.Process',
            threats,
            outOfScope: false,
        },
    });

    const makeFlowCell = (name, threats = []) => ({
        data: {
            name,
            type: 'tm.Flow',
            threats,
            outOfScope: false,
        },
    });

    const makeModel = (diagrams) => ({
        summary: { title: 'Test Model' },
        detail: { diagrams },
    });

    // -------------------------------------------------------------------------
    // Column headings / key presence
    // -------------------------------------------------------------------------
    describe('column headings', () => {
        it('returns objects with all nine required keys', () => {
            const threat = makeThreat();
            const model = makeModel([{ cells: [makeNodeCell('Auth Service', [threat])] }]);
            const rows = modelToRows(model);
            expect(rows).toHaveLength(1);
            const row = rows[0];
            expect(row).toHaveProperty('threatId');
            expect(row).toHaveProperty('assetAffected');
            expect(row).toHaveProperty('interaction');
            expect(row).toHaveProperty('title');
            expect(row).toHaveProperty('category');
            expect(row).toHaveProperty('description');
            expect(row).toHaveProperty('severity');
            expect(row).toHaveProperty('impact');
            expect(row).toHaveProperty('likelihood');
        });

        it('produces exactly nine keys — no extras, no missing', () => {
            const threat = makeThreat();
            const model = makeModel([{ cells: [makeNodeCell('X', [threat])] }]);
            const keys = Object.keys(modelToRows(model)[0]);
            expect(keys).toHaveLength(9);
        });
    });

    // -------------------------------------------------------------------------
    // Node cell (actor / process / store): Asset Affected filled, Interaction empty
    // -------------------------------------------------------------------------
    describe('node cell threat', () => {
        let row;

        beforeEach(() => {
            const threat = makeThreat();
            const model = makeModel([{ cells: [makeNodeCell('Payment Gateway', [threat])] }]);
            row = modelToRows(model)[0];
        });

        it('sets assetAffected to the cell name', () => {
            expect(row.assetAffected).toEqual('Payment Gateway');
        });

        it('leaves interaction empty', () => {
            expect(row.interaction).toEqual('');
        });
    });

    // -------------------------------------------------------------------------
    // Flow cell: Interaction filled, Asset Affected empty
    // -------------------------------------------------------------------------
    describe('flow cell threat', () => {
        let row;

        beforeEach(() => {
            const threat = makeThreat({ number: 2, title: 'Data interception' });
            const model = makeModel([{ cells: [makeFlowCell('HTTPS Request', [threat])] }]);
            row = modelToRows(model)[0];
        });

        it('leaves assetAffected empty', () => {
            expect(row.assetAffected).toEqual('');
        });

        it('sets interaction to the cell name', () => {
            expect(row.interaction).toEqual('HTTPS Request');
        });
    });

    // -------------------------------------------------------------------------
    // Threat Id: number takes priority over id
    // -------------------------------------------------------------------------
    describe('Threat Id mapping', () => {
        it('uses threat.number when present and non-zero', () => {
            const threat = makeThreat({ number: 7, id: 'some-uuid' });
            const model = makeModel([{ cells: [makeNodeCell('SVC', [threat])] }]);
            expect(modelToRows(model)[0].threatId).toEqual(7);
        });

        it('falls back to threat.id when number is 0', () => {
            const threat = makeThreat({ number: 0, id: 'fallback-uuid' });
            const model = makeModel([{ cells: [makeNodeCell('SVC', [threat])] }]);
            expect(modelToRows(model)[0].threatId).toEqual('fallback-uuid');
        });

        it('falls back to threat.id when number is absent', () => {
            const { number: _n, ...threat } = makeThreat({ id: 'only-id' });
            const model = makeModel([{ cells: [makeNodeCell('SVC', [threat])] }]);
            expect(modelToRows(model)[0].threatId).toEqual('only-id');
        });
    });

    // -------------------------------------------------------------------------
    // Core field mapping
    // -------------------------------------------------------------------------
    describe('field mapping', () => {
        let row;

        beforeEach(() => {
            const threat = makeThreat({
                number: 3,
                title: 'DoS Attack',
                type: 'Denial of service',
                description: 'Flood the endpoint.',
                severity: 'Medium',
            });
            const model = makeModel([{ cells: [makeNodeCell('API Server', [threat])] }]);
            row = modelToRows(model)[0];
        });

        it('maps title correctly', () => {
            expect(row.title).toEqual('DoS Attack');
        });

        it('maps category from threat.type', () => {
            expect(row.category).toEqual('Denial of service');
        });

        it('maps description correctly', () => {
            expect(row.description).toEqual('Flood the endpoint.');
        });

        it('maps severity correctly', () => {
            expect(row.severity).toEqual('Medium');
        });
    });

    // -------------------------------------------------------------------------
    // Impact / Likelihood: present → use value; absent → empty string
    // -------------------------------------------------------------------------
    describe('impact and likelihood', () => {
        it('populates impact when the field is present on the threat', () => {
            const threat = makeThreat({ impact: 'High' });
            const model = makeModel([{ cells: [makeNodeCell('X', [threat])] }]);
            expect(modelToRows(model)[0].impact).toEqual('High');
        });

        it('populates likelihood when the field is present on the threat', () => {
            const threat = makeThreat({ likelihood: 'Medium' });
            const model = makeModel([{ cells: [makeNodeCell('X', [threat])] }]);
            expect(modelToRows(model)[0].likelihood).toEqual('Medium');
        });

        it('leaves impact as empty string when the field is absent', () => {
            const threat = makeThreat();
            const model = makeModel([{ cells: [makeNodeCell('X', [threat])] }]);
            expect(modelToRows(model)[0].impact).toEqual('');
        });

        it('leaves likelihood as empty string when the field is absent', () => {
            const threat = makeThreat();
            const model = makeModel([{ cells: [makeNodeCell('X', [threat])] }]);
            expect(modelToRows(model)[0].likelihood).toEqual('');
        });
    });

    // -------------------------------------------------------------------------
    // Multiple diagrams: all threats aggregated
    // -------------------------------------------------------------------------
    describe('multiple diagrams', () => {
        it('aggregates threats from all diagrams', () => {
            const threatA = makeThreat({ number: 1, title: 'Threat A' });
            const threatB = makeThreat({ number: 2, title: 'Threat B' });
            const threatC = makeThreat({ number: 3, title: 'Threat C' });
            const model = makeModel([
                { cells: [makeNodeCell('Svc A', [threatA])] },
                { cells: [makeNodeCell('Svc B', [threatB]), makeFlowCell('Link', [threatC])] },
            ]);
            const rows = modelToRows(model);
            expect(rows).toHaveLength(3);
            expect(rows.map(r => r.title)).toEqual(['Threat A', 'Threat B', 'Threat C']);
        });

        it('returns empty array for a model with no threats', () => {
            const model = makeModel([{ cells: [makeNodeCell('X', [])] }]);
            expect(modelToRows(model)).toEqual([]);
        });
    });

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------
    describe('edge cases', () => {
        it('handles cells with no data gracefully', () => {
            const model = makeModel([{ cells: [{}] }]);
            expect(modelToRows(model)).toEqual([]);
        });

        it('handles cells with no threats array gracefully', () => {
            const model = makeModel([{ cells: [{ data: { name: 'X', type: 'tm.Process' } }] }]);
            expect(modelToRows(model)).toEqual([]);
        });

        it('handles an empty diagrams array', () => {
            const model = makeModel([]);
            expect(modelToRows(model)).toEqual([]);
        });

        it('handles null/undefined model gracefully', () => {
            expect(modelToRows(null)).toEqual([]);
            expect(modelToRows(undefined)).toEqual([]);
        });

        it('normalises newlines in cell names', () => {
            const threat = makeThreat();
            const model = makeModel([{ cells: [makeNodeCell('Background\nWorker', [threat])] }]);
            expect(modelToRows(model)[0].assetAffected).toEqual('Background Worker');
        });

        it('treats tm.Store cells as node (assetAffected)', () => {
            const cell = {
                data: { name: 'DB', type: 'tm.Store', threats: [makeThreat()] },
            };
            const model = makeModel([{ cells: [cell] }]);
            const row = modelToRows(model)[0];
            expect(row.assetAffected).toEqual('DB');
            expect(row.interaction).toEqual('');
        });

        it('treats tm.Actor cells as node (assetAffected)', () => {
            const cell = {
                data: { name: 'Browser', type: 'tm.Actor', threats: [makeThreat()] },
            };
            const model = makeModel([{ cells: [cell] }]);
            const row = modelToRows(model)[0];
            expect(row.assetAffected).toEqual('Browser');
            expect(row.interaction).toEqual('');
        });
    });
});
