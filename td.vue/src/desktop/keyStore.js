/**
 * @name keyStore
 * @description Desktop (Electron) storage for the BYO LLM settings and API keys.
 * Non-secret settings (selected provider/model) are stored in plain JSON under the
 * app's userData dir; API keys are encrypted at rest with Electron safeStorage.
 *
 * Factory takes its Electron/Node dependencies injected so it can be unit tested
 * without a running Electron process (mirrors the registerDesktop(deps) pattern).
 */
const FILE_NAME = 'llm-settings.json';

export const createKeyStore = ({ app, safeStorage, fs, path }) => {
    const file = path.join(app.getPath('userData'), FILE_NAME);

    const readRaw = () => {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            return {};
        }
    };

    const writeRaw = (obj) => {
        // Owner-only file: it holds (encrypted) credentials and selected settings.
        fs.writeFileSync(file, JSON.stringify(obj), { encoding: 'utf8', mode: 0o600 });
        try {
            fs.chmodSync(file, 0o600);
        } catch (e) {
            // best effort: some platforms (e.g. Windows) do not honour POSIX modes
        }
    };

    // API keys are only ever persisted encrypted. If the OS keyring is unavailable we
    // refuse to store rather than fall back to reversible base64 (which is NOT encryption).
    const encrypt = (value) => {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('OS keyring is unavailable; cannot securely store LLM credentials');
        }
        return safeStorage.encryptString(value).toString('base64');
    };

    const decrypt = (value) => safeStorage.decryptString(Buffer.from(value, 'base64'));

    return {
        getSettings() {
            const raw = readRaw();
            return { provider: raw.provider || null, model: raw.model || null };
        },
        setSettings({ provider, model } = {}) {
            const raw = readRaw();
            if (provider !== undefined) {
                raw.provider = provider;
            }
            if (model !== undefined) {
                raw.model = model;
            }
            writeRaw(raw);
        },
        getKey(provider) {
            const raw = readRaw();
            const keys = raw.keys || {};
            return keys[provider] ? decrypt(keys[provider]) : null;
        },
        setKey(provider, value) {
            const raw = readRaw();
            raw.keys = raw.keys || {};
            if (value) {
                raw.keys[provider] = encrypt(value);
            } else {
                delete raw.keys[provider];
            }
            writeRaw(raw);
        },
        hasKey(provider) {
            const raw = readRaw();
            return !!(raw.keys && raw.keys[provider]);
        },
        configuredProviders() {
            const raw = readRaw();
            return Object.keys(raw.keys || {});
        }
    };
};

export default { createKeyStore };
