import { expect } from 'chai';

import { mapAnthropicStream, streamAnthropic } from '../../src/llm/providers/anthropicStream.js';

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

describe('llm/providers/anthropicStream.js', () => {
    describe('mapAnthropicStream', () => {
        it('maps a text stream to normalized events', async () => {
            const raw = gen([
                { type: 'message_start' },
                { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
                { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
                { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
                { type: 'message_stop' }
            ]);

            const events = await collect(mapAnthropicStream(raw));

            expect(events).to.deep.equal([
                { type: 'message_start' },
                { type: 'text_delta', text: 'Hel' },
                { type: 'text_delta', text: 'lo' },
                { type: 'message_delta', stop_reason: 'end_turn' },
                { type: 'message_stop' }
            ]);
        });

        it('maps tool use blocks to tool_use_start/delta events', async () => {
            const raw = gen([
                { type: 'message_start' },
                { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'addElement' } },
                { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"kind":' } },
                { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"actor"}' } },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
                { type: 'message_stop' }
            ]);

            const events = await collect(mapAnthropicStream(raw));

            expect(events).to.deep.equal([
                { type: 'message_start' },
                { type: 'tool_use_start', index: 0, id: 'toolu_1', name: 'addElement' },
                { type: 'tool_use_delta', index: 0, partial_json: '{"kind":' },
                { type: 'tool_use_delta', index: 0, partial_json: '"actor"}' },
                { type: 'message_delta', stop_reason: 'tool_use' },
                { type: 'message_stop' }
            ]);
        });

        it('surfaces error events with a top-level message', async () => {
            const raw = gen([{ type: 'error', error: { message: 'overloaded' } }]);
            const events = await collect(mapAnthropicStream(raw));
            expect(events).to.deep.equal([
                { type: 'error', message: 'overloaded', error: { message: 'overloaded' } }
            ]);
        });
    });

    describe('streamAnthropic', () => {
        it('defaults max_tokens to 16384 when the caller does not specify one', async () => {
            let capturedParams;
            const fakeClient = {
                messages: {
                    stream (params) {
                        capturedParams = params;
                        return gen([{ type: 'message_stop' }]);
                    }
                }
            };

            await collect(streamAnthropic(fakeClient, {
                model: 'claude-opus-4-8',
                normalizedRequest: { messages: [] },
                signal: undefined
            }));

            expect(capturedParams.max_tokens).to.equal(16384);
        });

        it('honours a caller-supplied max_tokens over the default', async () => {
            let capturedParams;
            const fakeClient = {
                messages: {
                    stream (params) {
                        capturedParams = params;
                        return gen([{ type: 'message_stop' }]);
                    }
                }
            };

            await collect(streamAnthropic(fakeClient, {
                model: 'claude-opus-4-8',
                normalizedRequest: { messages: [], max_tokens: 4096 },
                signal: undefined
            }));

            expect(capturedParams.max_tokens).to.equal(4096);
        });

        it('retries without thinking when the model rejects adaptive thinking', async () => {
            const seen = [];
            // eslint-disable-next-line require-yield
            async function* throwing () {
                const err = new Error('400 adaptive thinking is not supported on this model');
                err.status = 400;
                throw err;
            }
            const fakeClient = {
                messages: {
                    stream (params) {
                        seen.push('thinking' in params ? params.thinking.type : 'none');
                        return seen.length === 1 ? throwing() : gen([{ type: 'message_stop' }]);
                    }
                }
            };

            const events = await collect(streamAnthropic(fakeClient, {
                model: 'claude-haiku-4-5',
                normalizedRequest: { messages: [] },
                signal: undefined
            }));

            // first attempt sent adaptive thinking, retry dropped it
            expect(seen).to.deep.equal(['adaptive', 'none']);
            expect(events).to.deep.equal([{ type: 'message_stop' }]);
        });

        it('does not retry a thinking rejection when the caller forced thinking', async () => {
            // eslint-disable-next-line require-yield
            async function* throwing () {
                const err = new Error('400 thinking is not supported');
                err.status = 400;
                throw err;
            }
            let calls = 0;
            const fakeClient = {
                messages: {
                    stream () {
                        calls += 1;
                        return throwing();
                    }
                }
            };

            let caught = null;
            try {
                await collect(streamAnthropic(fakeClient, {
                    model: 'claude-haiku-4-5',
                    normalizedRequest: { messages: [], thinking: { type: 'enabled' } },
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
