import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';

import editorContext from '../../src/helpers/editorContext.helper.js';

describe('helpers/editorContext.helper.js', () => {
    let originalEnv;
    let tmpDir;
    let stateFile;

    beforeEach(() => {
        originalEnv = process.env.TD_EDITOR_CONTEXT_FILE;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-editor-context-'));
        stateFile = path.join(tmpDir, 'editor-context.json');
        process.env.TD_EDITOR_CONTEXT_FILE = stateFile;
        editorContext.set(null);
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.TD_EDITOR_CONTEXT_FILE;
        } else {
            process.env.TD_EDITOR_CONTEXT_FILE = originalEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('getStateFilePath', () => {
        it('honors the TD_EDITOR_CONTEXT_FILE override', () => {
            expect(editorContext.getStateFilePath()).to.equal(stateFile);
        });

        it('defaults to ~/.threat-dragon/editor-context.json', () => {
            delete process.env.TD_EDITOR_CONTEXT_FILE;
            expect(editorContext.getStateFilePath()).to.equal(
                path.join(os.homedir(), '.threat-dragon', 'editor-context.json')
            );
        });
    });

    describe('set', () => {
        it('whitelists fields and stamps updatedAt as an ISO string', () => {
            const stored = editorContext.set({
                page: 'diagram',
                modelTitle: 'Demo Model',
                diagramId: 3,
                diagramTitle: 'Main Request Flow',
                evil: 'dropped',
                nested: { also: 'dropped' }
            });

            expect(stored.page).to.equal('diagram');
            expect(stored.modelTitle).to.equal('Demo Model');
            expect(stored.diagramId).to.equal(3);
            expect(stored.diagramTitle).to.equal('Main Request Flow');
            expect(stored).to.not.have.property('evil');
            expect(stored).to.not.have.property('nested');
            expect(new Date(stored.updatedAt).toISOString()).to.equal(stored.updatedAt);
            expect(editorContext.get()).to.deep.equal(stored);
        });

        it('accepts a string diagramId and drops non-string/non-number ones', () => {
            expect(editorContext.set({ diagramId: 'abc-123' }).diagramId).to.equal('abc-123');
            expect(editorContext.set({ page: 'model', diagramId: { bad: true } })).to.not.have.property('diagramId');
        });

        it('drops non-string values for string fields', () => {
            const stored = editorContext.set({ page: 42, modelTitle: 'ok' });
            expect(stored).to.not.have.property('page');
            expect(stored.modelTitle).to.equal('ok');
        });

        it('clears the context when given null', () => {
            editorContext.set({ page: 'diagram' });
            expect(editorContext.set(null)).to.equal(null);
            expect(editorContext.get()).to.equal(null);
        });

        it('clears the context when given an empty object', () => {
            editorContext.set({ page: 'diagram' });
            expect(editorContext.set({})).to.equal(null);
            expect(editorContext.get()).to.equal(null);
        });

        it('does not throw when the state file cannot be written', () => {
            // a path whose parent "directory" is an existing file: mkdir/write fail
            const blocker = path.join(tmpDir, 'blocker');
            fs.writeFileSync(blocker, 'not a directory');
            process.env.TD_EDITOR_CONTEXT_FILE = path.join(blocker, 'editor-context.json');

            const stored = editorContext.set({ page: 'diagram' });
            expect(stored.page).to.equal('diagram');
            expect(editorContext.get()).to.deep.equal(stored);
        });
    });

    describe('state file round-trip', () => {
        it('persists the stored context and reads it back via readFromFile', () => {
            const stored = editorContext.set({ page: 'diagram', diagramId: 7, diagramTitle: 'Flows' });
            expect(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).to.deep.equal(stored);
            expect(editorContext.readFromFile()).to.deep.equal(stored);
        });

        it('persists JSON null when cleared', () => {
            editorContext.set({ page: 'diagram' });
            editorContext.set(null);
            expect(fs.readFileSync(stateFile, 'utf8')).to.equal('null');
            expect(editorContext.readFromFile()).to.equal(null);
        });

        it('readFromFile returns null when the file is missing', () => {
            expect(editorContext.readFromFile()).to.equal(null);
        });

        it('readFromFile returns null when the file is not valid JSON', () => {
            fs.writeFileSync(stateFile, '{not json');
            expect(editorContext.readFromFile()).to.equal(null);
        });
    });
});
