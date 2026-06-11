import { reduceAssistant, reducer } from '@/plugins/vuex-persist.js';

// The assistant chat must survive navigation and full page loads (it is persisted
// to sessionStorage) until the user clears it. Only the DURABLE conversation state
// is persisted; volatile run-state and bulky attachments are dropped / reset so the
// restored object is the full module shape and cannot overflow the storage quota.
describe('plugins/vuex-persist reducer', () => {
    const liveAssistant = () => ({
        panelOpen: true,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        messages: [
            { role: 'user', content: [{ type: 'text', text: 'hello' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
        ],
        // volatile run-state that must NOT persist
        streaming: true,
        streamingText: 'partial…',
        pendingToolCalls: [{ id: 'a', name: 'createThreat', status: 'running' }],
        runState: 'running',
        attachments: [{ kind: 'image', mediaType: 'image/png', data: 'AAAA' }],
        error: 'boom',
        abortRequested: true,
        sectionProgress: { current: 1, total: 3, name: 'spec.pdf' }
    });

    it('persists the durable conversation state', () => {
        const out = reduceAssistant(liveAssistant());
        expect(out.panelOpen).toBe(true);
        expect(out.provider).toBe('anthropic');
        expect(out.model).toBe('claude-sonnet-4-6');
        expect(out.messages).toHaveLength(2);
        expect(out.messages[0].content[0].text).toBe('hello');
    });

    it('resets volatile run-state to its initial values', () => {
        const out = reduceAssistant(liveAssistant());
        expect(out.streaming).toBe(false);
        expect(out.streamingText).toBe('');
        expect(out.pendingToolCalls).toEqual([]);
        expect(out.runState).toBe('idle');
        expect(out.error).toBeNull();
        expect(out.abortRequested).toBe(false);
        expect(out.sectionProgress).toBeNull();
    });

    it('never persists attachments (multi-MB base64 page images)', () => {
        const out = reduceAssistant(liveAssistant());
        expect(out.attachments).toEqual([]);
    });

    it('returns the full module shape so it merges cleanly over initialState', () => {
        const out = reduceAssistant(liveAssistant());
        expect(Object.keys(out).sort()).toEqual([
            'abortRequested', 'attachments', 'error', 'messages', 'model',
            'panelOpen', 'pendingToolCalls', 'provider', 'runState',
            'sectionProgress', 'streaming', 'streamingText'
        ]);
        // no volatile key restores to undefined
        Object.values(out).forEach((v) => expect(v).not.toBeUndefined());
    });

    it('strips image blocks from persisted messages', () => {
        const out = reduceAssistant({
            panelOpen: false,
            provider: 'anthropic',
            model: 'm',
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'X'.repeat(1000) } },
                    { type: 'text', text: 'see attached' }
                ]
            }]
        });
        const blocks = out.messages[0].content;
        expect(blocks.find((b) => b.type === 'image')).toBeUndefined();
        expect(blocks[0]).toEqual({ type: 'text', text: '[image omitted]' });
        expect(blocks[1]).toEqual({ type: 'text', text: 'see attached' });
    });

    it('stubs over-long text blocks so sessionStorage cannot overflow', () => {
        const huge = 'x'.repeat(60000);
        const out = reduceAssistant({
            panelOpen: false,
            provider: 'anthropic',
            model: 'm',
            messages: [{ role: 'user', content: [{ type: 'text', text: huge }] }]
        });
        expect(out.messages[0].content[0].text).toBe('[large document text omitted]');
    });

    it('keeps normal-length text and tool blocks untouched', () => {
        const message = {
            role: 'assistant',
            content: [
                { type: 'text', text: 'a normal reply' },
                { type: 'tool_use', id: 't1', name: 'createThreat', input: { x: 1 } }
            ]
        };
        const out = reduceAssistant({
            panelOpen: false, provider: 'anthropic', model: 'm', messages: [message]
        });
        expect(out.messages[0].content).toEqual(message.content);
    });

    it('defaults empty/missing fields safely', () => {
        const out = reduceAssistant({});
        expect(out.panelOpen).toBe(false);
        expect(out.provider).toBeNull();
        expect(out.model).toBeNull();
        expect(out.messages).toEqual([]);
    });

    it('top-level reducer keeps other modules intact and slims assistant', () => {
        const state = {
            threatmodel: { data: { summary: { title: 't' } } },
            auth: { jwt: 'token' },
            assistant: liveAssistant()
        };
        const out = reducer(state);
        expect(out.threatmodel).toBe(state.threatmodel);
        expect(out.auth).toBe(state.auth);
        expect(out.assistant.attachments).toEqual([]);
        expect(out.assistant.runState).toBe('idle');
        expect(out.assistant.model).toBe('claude-sonnet-4-6');
    });
});
