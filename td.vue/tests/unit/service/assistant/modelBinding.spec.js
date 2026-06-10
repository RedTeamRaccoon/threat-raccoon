import { createModelBinding } from '@/service/assistant/modelBinding.js';
import {
    THREATMODEL_DATA_REPLACED,
    THREATMODEL_MODIFIED
} from '@/store/actions/threatmodel.js';

// NOTE: importing modelBinding pulls in '@tmcore/ops.js', whose './validate.js'
// import is remapped to src/service/schema/tmcoreValidate.js by the jest
// moduleNameMapper (mirroring the webpack NormalModuleReplacementPlugin). Every
// mutating op below passes through assertValid -> the shim -> the app's AJV, so
// these tests also prove the validate.js substitution works end to end.

const blankModel = () => ({
    version: '2.0',
    summary: { title: 't', owner: '', description: '', id: 0 },
    detail: { contributors: [], diagrams: [], diagramTop: 0, reviewer: '', threatTop: 0 }
});

const makeStore = (data) => ({
    state: { threatmodel: { data } },
    dispatch: jest.fn()
});

describe('service/assistant/modelBinding.js', () => {
    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    describe('createDiagram', () => {
        let store, res;

        beforeEach(async () => {
            store = makeStore(blankModel());
            const binding = createModelBinding(store);
            res = await binding.execute('createDiagram', { title: 'DFD', diagramType: 'STRIDE' });
        });

        it('returns the new diagramId', () => {
            expect(res).toEqual({ ok: true, result: { diagramId: 0 } });
        });

        it('dispatches dataReplaced with the diagram added', () => {
            expect(store.dispatch).toHaveBeenCalledWith(
                THREATMODEL_DATA_REPLACED,
                expect.objectContaining({
                    detail: expect.objectContaining({
                        diagramTop: 1,
                        diagrams: [expect.objectContaining({ id: 0, title: 'DFD', diagramType: 'STRIDE' })]
                    })
                })
            );
        });

        it('marks the model as modified', () => {
            expect(store.dispatch).toHaveBeenCalledWith(THREATMODEL_MODIFIED);
        });

        it('does not mutate the stored model in place (pure op on a clone)', () => {
            expect(store.state.threatmodel.data.detail.diagrams).toHaveLength(0);
        });
    });

    describe('addElement into a created diagram', () => {
        let store, res;

        beforeEach(async () => {
            store = makeStore(blankModel());
            const binding = createModelBinding(store);
            await binding.execute('createDiagram', { title: 'DFD', diagramType: 'STRIDE' });
            // the store dispatch is mocked, so state.data does not update by
            // itself — feed the dispatched model back in to chain the ops
            store.state.threatmodel.data = store.dispatch.mock.calls
                .find(([action]) => action === THREATMODEL_DATA_REPLACED)[1];
            store.dispatch.mockClear();
            res = await binding.execute('addElement', {
                diagramId: 0,
                kind: 'process',
                name: 'Web API',
                position: { x: 100, y: 120 }
            });
        });

        it('returns the new cellId', () => {
            expect(res.ok).toBe(true);
            expect(res.result.cellId).toEqual(expect.any(String));
        });

        it('dispatches dataReplaced with the element in the diagram', () => {
            const replaced = store.dispatch.mock.calls
                .find(([action]) => action === THREATMODEL_DATA_REPLACED)[1];
            const cells = replaced.detail.diagrams[0].cells;
            expect(cells).toHaveLength(1);
            expect(cells[0]).toMatchObject({
                id: res.result.cellId,
                shape: 'process',
                position: { x: 100, y: 120 },
                data: expect.objectContaining({ type: 'tm.Process', name: 'Web API' })
            });
            expect(store.dispatch).toHaveBeenCalledWith(THREATMODEL_MODIFIED);
        });
    });

    describe('readonly ops', () => {
        it('getModelSummary returns the summary and dispatches nothing', async () => {
            const store = makeStore(blankModel());
            const binding = createModelBinding(store);
            const res = await binding.execute('getModelSummary');
            expect(res.ok).toBe(true);
            expect(res.result).toEqual({
                diagrams: [],
                totals: { elements: 0, threats: 0, openThreats: 0, bySeverity: {} }
            });
            expect(store.dispatch).not.toHaveBeenCalled();
        });
    });

    describe('failure modes', () => {
        it('returns ok:false for an unknown op', async () => {
            const store = makeStore(blankModel());
            const binding = createModelBinding(store);
            const res = await binding.execute('explodeModel', {});
            expect(res).toEqual({ ok: false, error: 'Unknown operation "explodeModel"' });
            expect(store.dispatch).not.toHaveBeenCalled();
        });

        it.each([
            ['missing', undefined],
            ['empty', {}],
            ['lacking detail', { version: '2.0', summary: { title: 't' } }]
        ])('returns ok:false when the model is %s', async (_label, data) => {
            const store = makeStore(data);
            const binding = createModelBinding(store);
            const res = await binding.execute('createDiagram', { title: 'DFD' });
            expect(res).toEqual({ ok: false, error: 'No threat model is open' });
            expect(store.dispatch).not.toHaveBeenCalled();
        });

        it('returns ok:false (and dispatches nothing) when the op throws', async () => {
            const store = makeStore(blankModel());
            const binding = createModelBinding(store);
            const res = await binding.execute('addElement', {
                diagramId: 99,
                kind: 'process',
                name: 'nope'
            });
            expect(res.ok).toBe(false);
            expect(res.error).toMatch(/Diagram not found/);
            expect(store.dispatch).not.toHaveBeenCalled();
        });
    });
});
