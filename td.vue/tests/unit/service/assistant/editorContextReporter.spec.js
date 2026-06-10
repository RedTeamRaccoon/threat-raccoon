import isElectron from 'is-electron';

import api from '@/service/api/api.js';
import storeFactory from '@/store/index.js';
import editorContextReporter from '@/service/assistant/editorContextReporter.js';

jest.mock('is-electron', () => jest.fn());
jest.mock('@/service/api/api.js', () => ({ putAsync: jest.fn() }));
jest.mock('@/store/index.js', () => ({ get: jest.fn() }));

describe('service/assistant/editorContextReporter.js', () => {
    beforeEach(() => {
        // resetMocks wipes implementations between tests
        isElectron.mockReturnValue(false);
        storeFactory.get.mockReturnValue({ state: { auth: { jwt: 'a.jwt.token' } } });
        api.putAsync.mockResolvedValue({});
        jest.spyOn(console, 'debug').mockImplementation(() => {});
    });

    it('PUTs the context to the editor context endpoint', async () => {
        const context = { page: 'diagram', modelTitle: 'tm', diagramId: 1, diagramTitle: 'd1' };
        await editorContextReporter.report(context);
        expect(api.putAsync).toHaveBeenCalledWith('/api/editor/context', context);
    });

    it('defaults a missing context to an empty object', async () => {
        await editorContextReporter.report(null);
        expect(api.putAsync).toHaveBeenCalledWith('/api/editor/context', {});
    });

    it('is a no-op on desktop', async () => {
        isElectron.mockReturnValue(true);
        await editorContextReporter.report({ page: 'dashboard' });
        expect(storeFactory.get).not.toHaveBeenCalled();
        expect(api.putAsync).not.toHaveBeenCalled();
    });

    it('is a no-op without a JWT', async () => {
        storeFactory.get.mockReturnValue({ state: { auth: { jwt: '' } } });
        await editorContextReporter.report({ page: 'dashboard' });
        expect(api.putAsync).not.toHaveBeenCalled();
    });

    it('is a no-op without auth state', async () => {
        storeFactory.get.mockReturnValue({ state: {} });
        await editorContextReporter.report({ page: 'dashboard' });
        expect(api.putAsync).not.toHaveBeenCalled();
    });

    it('swallows transport failures silently', async () => {
        api.putAsync.mockRejectedValue(new Error('boom'));
        await expect(editorContextReporter.report({ page: 'model' })).resolves.toBeUndefined();
    });
});
