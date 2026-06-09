import { createKeyStore } from '@/desktop/keyStore.js';

const makeFs = () => {
    const files = {};
    return {
        files,
        readFileSync: (p) => {
            if (!(p in files)) {
                throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            }
            return files[p];
        },
        writeFileSync: (p, content) => {
            files[p] = content;
        },
        chmodSync: () => {}
    };
};

const path = { join: (...parts) => parts.join('/') };
const app = { getPath: () => '/userData' };

describe('desktop/keyStore', () => {
    describe('with safeStorage encryption available', () => {
        const safeStorage = {
            isEncryptionAvailable: () => true,
            encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
            decryptString: (b) => b.toString('utf8').replace(/^enc:/, '')
        };

        it('round-trips an encrypted key and never stores it in plaintext', () => {
            const fs = makeFs();
            const store = createKeyStore({ app, safeStorage, fs, path });

            store.setKey('anthropic', 'sk-secret');
            expect(store.getKey('anthropic')).toBe('sk-secret');
            expect(store.hasKey('anthropic')).toBe(true);
            expect(store.configuredProviders()).toEqual(['anthropic']);

            // the raw file must not contain the plaintext secret
            expect(fs.files['/userData/llm-settings.json']).not.toContain('sk-secret');
        });

        it('persists non-secret settings', () => {
            const fs = makeFs();
            const store = createKeyStore({ app, safeStorage, fs, path });
            store.setSettings({ provider: 'anthropic', model: 'claude-opus-4-8' });
            expect(store.getSettings()).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
        });

        it('removes a key when set to empty', () => {
            const fs = makeFs();
            const store = createKeyStore({ app, safeStorage, fs, path });
            store.setKey('openai', 'k');
            store.setKey('openai', '');
            expect(store.hasKey('openai')).toBe(false);
        });
    });

    it('refuses to store a key (no plaintext fallback) when encryption is unavailable', () => {
        const safeStorage = { isEncryptionAvailable: () => false };
        const fs = makeFs();
        const store = createKeyStore({ app, safeStorage, fs, path });
        expect(() => store.setKey('openai', 'plain')).toThrow(/keyring/i);
        expect(store.hasKey('openai')).toBe(false);
    });

    it('writes the settings file owner-only (mode 0600)', () => {
        const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s, 'utf8') };
        const writes = [];
        const fs = {
            readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
            writeFileSync: (p, content, opts) => writes.push(opts),
            chmodSync: jest.fn()
        };
        const store = createKeyStore({ app, safeStorage, fs, path });
        store.setSettings({ provider: 'anthropic' });
        expect(writes[0]).toEqual({ encoding: 'utf8', mode: 0o600 });
        expect(fs.chmodSync).toHaveBeenCalledWith('/userData/llm-settings.json', 0o600);
    });

    it('returns empty defaults when no file exists yet', () => {
        const store = createKeyStore({ app, safeStorage: { isEncryptionAvailable: () => true }, fs: makeFs(), path });
        expect(store.getSettings()).toEqual({ provider: null, model: null });
        expect(store.getKey('anthropic')).toBeNull();
        expect(store.configuredProviders()).toEqual([]);
    });
});
