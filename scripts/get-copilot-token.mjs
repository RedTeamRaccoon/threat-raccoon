#!/usr/bin/env node
/**
 * @name get-copilot-token
 * @description Generates a GitHub Copilot OAuth token via the GitHub device flow,
 * displays it, and stores it in the repo `.env` as `LLM_COPILOT_API_KEY` so the
 * Threat Dragon in-app assistant can use GitHub Copilot as its provider.
 *
 * The token is the OAuth token the Copilot editor integrations use; Threat
 * Dragon's copilot adapter exchanges it for a short-lived Copilot bearer at
 * api.github.com/copilot_internal/v2/token. A classic Personal Access Token does
 * NOT work - it has no Copilot entitlement on that endpoint.
 *
 * Cross-platform, no external dependencies (uses Node's global fetch - Node 18+).
 *
 * Usage:
 *   node scripts/get-copilot-token.mjs            # writes ../.env (repo root)
 *   node scripts/get-copilot-token.mjs --print    # also prints the token to stdout
 *   node scripts/get-copilot-token.mjs --env path/to/.env
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The well-known GitHub Copilot OAuth app client id used by the editor
// integrations (VS Code / Neovim copilot.vim etc.). Device-flow tokens minted
// against it carry the user's Copilot entitlement.
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

const args = process.argv.slice(2);
const wantPrint = args.includes('--print');
const envFlagIdx = args.indexOf('--env');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = envFlagIdx >= 0 && args[envFlagIdx + 1]
    ? path.resolve(args[envFlagIdx + 1])
    : path.join(repoRoot, '.env');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const postForm = async (url, body) => {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString()
    });
    if (!res.ok) {
        throw new Error(`${url} -> HTTP ${res.status}`);
    }
    return res.json();
};

const requestDeviceCode = () => postForm(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: 'read:user' });

const pollForToken = async (deviceCode, intervalSeconds, expiresIn) => {
    const deadline = Date.now() + expiresIn * 1000;
    let interval = Math.max(intervalSeconds, 5);
    while (Date.now() < deadline) {
        await sleep(interval * 1000);
        const data = await postForm(ACCESS_TOKEN_URL, {
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        });
        if (data.access_token) {
            return data.access_token;
        }
        if (data.error === 'authorization_pending') {
            continue;
        }
        if (data.error === 'slow_down') {
            interval += 5;
            continue;
        }
        if (data.error === 'expired_token') {
            throw new Error('The device code expired before you authorized it. Re-run the script.');
        }
        if (data.error === 'access_denied') {
            throw new Error('Authorization was denied in the browser.');
        }
        throw new Error(`Device authorization failed: ${data.error_description || data.error}`);
    }
    throw new Error('Timed out waiting for browser authorization.');
};

// Confirm the token actually has Copilot access (Threat Dragon needs this exact
// exchange to work). Returns true/false; never throws on a plain 401/403.
const verifyCopilotEntitlement = async (token) => {
    try {
        const res = await fetch(COPILOT_TOKEN_URL, {
            headers: { 'Authorization': `token ${token}`, 'User-Agent': 'threat-dragon-setup' }
        });
        return res.ok;
    } catch {
        return false;
    }
};

// Read .env (creating it from example.env when absent) and upsert KEY=value pairs.
const upsertEnv = (file, updates) => {
    let lines = [];
    if (fs.existsSync(file)) {
        lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    } else {
        const example = path.join(repoRoot, 'example.env');
        if (fs.existsSync(example)) {
            lines = fs.readFileSync(example, 'utf8').split(/\r?\n/);
            console.log(`No .env found - created one from example.env at ${file}`);
        }
    }
    for (const [key, value] of Object.entries(updates)) {
        const idx = lines.findIndex((l) => l.match(new RegExp(`^\\s*${key}=`)));
        if (idx >= 0) {
            lines[idx] = `${key}=${value}`;
        } else {
            lines.push(`${key}=${value}`);
        }
    }
    fs.writeFileSync(file, lines.join('\n'));
};

const main = async () => {
    console.log('\n  Threat Dragon - GitHub Copilot token setup\n  ==========================================\n');
    console.log('  Requesting a device code from GitHub...');
    const device = await requestDeviceCode();

    console.log('\n  1. Open this URL in your browser:  ' + (device.verification_uri || 'https://github.com/login/device'));
    console.log('  2. Enter this one-time code:       ' + device.user_code);
    console.log('  3. Approve access for GitHub Copilot.\n');
    console.log('  Waiting for you to authorize... (this window will continue automatically)\n');

    const token = await pollForToken(device.device_code, device.interval || 5, device.expires_in || 900);

    process.stdout.write('  Verifying Copilot entitlement... ');
    const entitled = await verifyCopilotEntitlement(token);
    console.log(entitled ? 'OK' : 'WARNING: this account does not appear to have Copilot access.');

    upsertEnv(envPath, {
        LLM_COPILOT_API_KEY: token,
        LLM_ENABLED: 'true',
        LLM_PROVIDER: 'copilot'
    });
    // Only set a default model if one isn't already present.
    const env = fs.readFileSync(envPath, 'utf8');
    if (!/^\s*LLM_COPILOT_MODEL=\S/m.test(env)) {
        upsertEnv(envPath, { LLM_COPILOT_MODEL: 'gpt-4o' });
    }

    console.log('\n  Saved to ' + envPath + ':');
    console.log('    LLM_COPILOT_API_KEY=' + (wantPrint ? token : token.slice(0, 7) + '...' + token.slice(-4)));
    console.log('    LLM_ENABLED=true');
    console.log('    LLM_PROVIDER=copilot');
    if (!entitled) {
        console.log('\n  NOTE: the token saved but Copilot access was not confirmed. Make sure this');
        console.log('  GitHub account has an active Copilot subscription, then try again.');
    }
    console.log('\n  Done. GitHub Copilot is now configured as the Threat Dragon provider.\n');
};

main().catch((e) => {
    console.error('\n  ERROR: ' + e.message + '\n');
    process.exit(1);
});
