import { createMcpFileStore } from '@/desktop/mcpFileStore.js';

describe('desktop/mcpFileStore', () => {
    it('loads the model from the open file', async () => {
        const fs = { readFileSync: jest.fn(() => JSON.stringify({ version: '2.0' })), writeFileSync: jest.fn() };
        const store = createMcpFileStore({ fs, getFilePath: () => '/models/m.json' });
        const model = await store.loadModel();
        expect(model).toEqual({ version: '2.0' });
        expect(fs.readFileSync).toHaveBeenCalledWith('/models/m.json', 'utf8');
    });

    it('saves the model to the open file as formatted JSON', async () => {
        const fs = { readFileSync: jest.fn(), writeFileSync: jest.fn() };
        const store = createMcpFileStore({ fs, getFilePath: () => '/models/m.json' });
        await store.saveModel({ version: '2.0', summary: { title: 'T' } });
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            '/models/m.json',
            JSON.stringify({ version: '2.0', summary: { title: 'T' } }, null, 2),
            'utf8'
        );
    });

    it('rejects when no file is open', async () => {
        const fs = { readFileSync: jest.fn(), writeFileSync: jest.fn() };
        const store = createMcpFileStore({ fs, getFilePath: () => null });
        await expect(store.loadModel()).rejects.toThrow(/No model file/);
        await expect(store.saveModel({})).rejects.toThrow(/No model file/);
    });
});
