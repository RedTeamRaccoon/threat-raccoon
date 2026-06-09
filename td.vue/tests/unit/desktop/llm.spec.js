import { TextEncoder, TextDecoder } from 'util';

import { createLlmRelay, toOpenAiMessages, toOpenAiTools } from '@/desktop/llm.js';

// jsdom does not expose TextEncoder/TextDecoder; they are globals in Electron's Node
// main process (where this relay runs) and in browsers, so polyfill them for the test.
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

const sseResponse = (chunks) => ({
    ok: true,
    body: {
        getReader: () => {
            let i = 0;
            return {
                read: () => (i < chunks.length
                    ? Promise.resolve({ value: new TextEncoder().encode(chunks[i++]), done: false })
                    : Promise.resolve({ value: undefined, done: true }))
            };
        }
    }
});

const collect = async (relay, request) => {
    const events = [];
    await relay.streamCompletion(request, (e) => events.push(e));
    return events;
};

describe('desktop/llm relay', () => {
    describe('toOpenAiMessages', () => {
        it('translates system, text, tool_use and tool_result blocks', () => {
            const out = toOpenAiMessages({
                system: 'be helpful',
                messages: [
                    { role: 'user', content: [{ type: 'text', text: 'build it' }] },
                    { role: 'assistant', content: [
                        { type: 'text', text: 'sure' },
                        { type: 'tool_use', id: 't1', name: 'addElement', input: { kind: 'process' } }
                    ] },
                    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"cellId":"c1"}' }] }
                ]
            });

            expect(out[0]).toEqual({ role: 'system', content: 'be helpful' });
            expect(out[1]).toEqual({ role: 'user', content: 'build it' });
            expect(out[2]).toMatchObject({
                role: 'assistant',
                content: 'sure',
                tool_calls: [{ id: 't1', type: 'function', function: { name: 'addElement', arguments: '{"kind":"process"}' } }]
            });
            expect(out[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: '{"cellId":"c1"}' });
        });

        it('maps tool input_schema to function parameters', () => {
            const tools = toOpenAiTools([{ name: 'addElement', description: 'add', input_schema: { type: 'object' } }]);
            expect(tools[0]).toEqual({
                type: 'function',
                function: { name: 'addElement', description: 'add', parameters: { type: 'object' } }
            });
        });
    });

    it('errors when no key is configured', async () => {
        const relay = createLlmRelay({ getKey: () => null, fetchImpl: jest.fn() });
        const events = await collect(relay, { provider: 'openai', model: 'm', messages: [] });
        expect(events).toEqual([{ type: 'error', message: expect.stringMatching(/No API key/) }]);
    });

    it('normalizes an Anthropic stream', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(sseResponse([
            'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","id":"t1","name":"addElement"}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ]));
        const relay = createLlmRelay({ getKey: () => 'sk', fetchImpl });
        const events = await collect(relay, { provider: 'anthropic', model: 'claude-opus-4-8', messages: [], tools: [] });

        expect(events.map((e) => e.type)).toEqual(['tool_use_start', 'text_delta', 'message_stop']);
        expect(events[0]).toMatchObject({ id: 't1', name: 'addElement' });
        expect(fetchImpl.mock.calls[0][1].headers['x-api-key']).toBe('sk');
    });

    it('uses OAuth bearer + beta header for claudecode (never x-api-key)', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(sseResponse([
            'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ]));
        const relay = createLlmRelay({ getKey: () => 'oauth-tok', fetchImpl });
        await collect(relay, { provider: 'claudecode', model: 'claude-opus-4-8', messages: [], tools: [] });

        const headers = fetchImpl.mock.calls[0][1].headers;
        expect(headers.authorization).toBe('Bearer oauth-tok');
        expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');
        expect(headers['x-api-key']).toBeUndefined();
    });

    it('normalizes an OpenAI-compatible stream', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(sseResponse([
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"connectFlow","arguments":"{\\"a\\":1}"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
            'data: [DONE]\n\n'
        ]));
        const relay = createLlmRelay({ getKey: () => 'sk', fetchImpl });
        const events = await collect(relay, { provider: 'openai', model: 'gpt-4o', messages: [], tools: [] });

        expect(events.map((e) => e.type)).toEqual([
            'text_delta', 'tool_use_start', 'tool_use_delta', 'message_delta', 'message_stop'
        ]);
        expect(events[1]).toMatchObject({ id: 'c1', name: 'connectFlow' });
        expect(events[3]).toMatchObject({ stop_reason: 'tool_use' });
        expect(fetchImpl.mock.calls[0][0]).toMatch(/api\.openai\.com/);
        expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer sk');
    });

    it('targets the Copilot endpoint for the copilot provider', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(sseResponse(['data: [DONE]\n\n']));
        const relay = createLlmRelay({ getKey: () => 'tok', fetchImpl });
        await collect(relay, { provider: 'copilot', model: 'gpt-4o', messages: [], tools: [] });
        expect(fetchImpl.mock.calls[0][0]).toMatch(/githubcopilot\.com/);
    });
});
