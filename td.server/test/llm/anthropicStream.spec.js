import { expect } from 'chai';

import { mapAnthropicStream } from '../../src/llm/providers/anthropicStream.js';

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
});
