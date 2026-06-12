import { expect } from 'chai';

import {
    mapOpenAiStream,
    streamOpenAi,
    toOpenAiMessages,
    toOpenAiTools
} from '../../src/llm/providers/openaiTranslate.js';

async function* gen (items) {
    for (const item of items) {
        yield item;
    }
}

const collect = async (iterable) => {
    const out = [];
    for await (const event of iterable) {
        out.push(event);
    }
    return out;
};

describe('llm/providers/openaiTranslate.js', () => {
    describe('toOpenAiMessages', () => {
        it('prepends the system prompt and flattens text content', () => {
            const result = toOpenAiMessages({
                system: 'you are helpful',
                messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
            });
            expect(result).to.deep.equal([
                { role: 'system', content: 'you are helpful' },
                { role: 'user', content: 'hi' }
            ]);
        });

        it('translates user image blocks into multi-part image_url content', () => {
            const result = toOpenAiMessages({
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'see attached diagram' },
                        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }
                    ]
                }]
            });
            expect(result).to.deep.equal([{
                role: 'user',
                content: [
                    { type: 'text', text: 'see attached diagram' },
                    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }
                ]
            }]);
        });

        it('keeps plain string content when there are no images', () => {
            const result = toOpenAiMessages({
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'part one ' },
                        { type: 'text', text: 'part two' }
                    ]
                }]
            });
            expect(result).to.deep.equal([{ role: 'user', content: 'part one part two' }]);
        });

        it('translates assistant tool_use blocks into tool_calls', () => {
            const result = toOpenAiMessages({
                messages: [{
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'calling' },
                        { type: 'tool_use', id: 'call_1', name: 'addThreat', input: { severity: 'High' } }
                    ]
                }]
            });
            expect(result).to.deep.equal([{
                role: 'assistant',
                content: 'calling',
                tool_calls: [{
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'addThreat', arguments: '{"severity":"High"}' }
                }]
            }]);
        });

        it('translates user tool_result blocks into role:tool messages', () => {
            const result = toOpenAiMessages({
                messages: [{
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }]
                }]
            });
            expect(result).to.deep.equal([
                { role: 'tool', tool_call_id: 'call_1', content: 'ok' }
            ]);
        });
    });

    describe('toOpenAiTools', () => {
        it('maps input_schema to function.parameters', () => {
            const result = toOpenAiTools([
                { name: 'addElement', description: 'add', input_schema: { type: 'object' } }
            ]);
            expect(result).to.deep.equal([{
                type: 'function',
                function: { name: 'addElement', description: 'add', parameters: { type: 'object' } }
            }]);
        });
    });

    describe('mapOpenAiStream', () => {
        it('maps content deltas and finish reason to normalized events', async () => {
            const raw = gen([
                { choices: [{ delta: { content: 'Hel' } }] },
                { choices: [{ delta: { content: 'lo' } }] },
                { choices: [{ delta: {}, finish_reason: 'stop' }] }
            ]);

            const events = await collect(mapOpenAiStream(raw));

            expect(events).to.deep.equal([
                { type: 'message_start' },
                { type: 'text_delta', text: 'Hel' },
                { type: 'text_delta', text: 'lo' },
                { type: 'message_delta', stop_reason: 'end_turn' },
                { type: 'message_stop' }
            ]);
        });

        it('maps streamed tool calls to tool_use_start/delta events', async () => {
            const raw = gen([
                { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'addElement', arguments: '{"kind"' } }] } }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"actor"}' } }] } }] },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
            ]);

            const events = await collect(mapOpenAiStream(raw));

            expect(events).to.deep.equal([
                { type: 'message_start' },
                { type: 'tool_use_start', index: 0, id: 'call_1', name: 'addElement' },
                { type: 'tool_use_delta', index: 0, partial_json: '{"kind"' },
                { type: 'tool_use_delta', index: 0, partial_json: ':"actor"}' },
                { type: 'message_delta', stop_reason: 'tool_use' },
                { type: 'message_stop' }
            ]);
        });
    });

    describe('streamOpenAi', () => {
        it('defaults max_tokens to 16384 when the caller does not specify one', async () => {
            let capturedParams;
            const fakeClient = {
                chat: {
                    completions: {
                        create (params) {
                            capturedParams = params;
                            return Promise.resolve(gen([]));
                        }
                    }
                }
            };

            await collect(streamOpenAi(fakeClient, {
                model: 'gpt-4o',
                normalizedRequest: { messages: [] },
                signal: undefined
            }));

            expect(capturedParams.max_tokens).to.equal(16384);
        });

        it('honours a caller-supplied max_tokens over the default', async () => {
            let capturedParams;
            const fakeClient = {
                chat: {
                    completions: {
                        create (params) {
                            capturedParams = params;
                            return Promise.resolve(gen([]));
                        }
                    }
                }
            };

            await collect(streamOpenAi(fakeClient, {
                model: 'gpt-4o',
                normalizedRequest: { messages: [], max_tokens: 4096 },
                signal: undefined
            }));

            expect(capturedParams.max_tokens).to.equal(4096);
        });

        it('retries with max_completion_tokens when the model rejects max_tokens', async () => {
            const calls = [];
            const fakeClient = {
                chat: {
                    completions: {
                        create (params) {
                            calls.push({ ...params });
                            if (calls.length === 1) {
                                const err = new Error(
                                    "Unsupported parameter: 'max_tokens' is not supported with this "
                                    + "model. Use 'max_completion_tokens' instead.");
                                err.status = 400;
                                return Promise.reject(err);
                            }
                            return Promise.resolve(gen([]));
                        }
                    }
                }
            };

            await collect(streamOpenAi(fakeClient, {
                model: 'gpt-5.5',
                normalizedRequest: { messages: [], max_tokens: 4096 },
                signal: undefined
            }));

            // first attempt used max_tokens; retry swapped to max_completion_tokens
            expect(calls).to.have.lengthOf(2);
            expect(calls[0].max_tokens).to.equal(4096);
            expect(calls[0].max_completion_tokens).to.equal(undefined);
            expect(calls[1].max_tokens).to.equal(undefined);
            expect(calls[1].max_completion_tokens).to.equal(4096);
        });

        it('does not retry a 400 that is unrelated to the token parameter', async () => {
            let calls = 0;
            const fakeClient = {
                chat: {
                    completions: {
                        create () {
                            calls += 1;
                            const err = new Error('400 invalid model');
                            err.status = 400;
                            return Promise.reject(err);
                        }
                    }
                }
            };

            let caught = null;
            try {
                await collect(streamOpenAi(fakeClient, {
                    model: 'gpt-4o',
                    normalizedRequest: { messages: [] },
                    signal: undefined
                }));
            } catch (e) {
                caught = e;
            }

            expect(caught).to.not.equal(null);
            expect(calls).to.equal(1);
        });
    });
});
