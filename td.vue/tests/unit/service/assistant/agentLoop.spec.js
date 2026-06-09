import { runAgentLoop } from '@/service/assistant/agentLoop.js';

const okBinding = (impl) => ({
    execute: jest.fn(impl || (() => Promise.resolve({ ok: true, result: { cellId: 'c1' } })))
});

describe('service/assistant/agentLoop', () => {
    it('streams a turn, executes tool calls, posts results and loops until no tools', async () => {
        const proxy = { streamCompletion: jest.fn() };
        proxy.streamCompletion
            .mockImplementationOnce((req, { onEvent }) => {
                onEvent({ type: 'text_delta', text: 'Let me build that.' });
                onEvent({ type: 'tool_use_start', id: 't1', name: 'addElement' });
                onEvent({ type: 'tool_use_delta', partial_json: '{"kind":"process","name":"API"}' });
                return Promise.resolve();
            })
            .mockImplementationOnce((req, { onEvent }) => {
                onEvent({ type: 'text_delta', text: 'All done.' });
                return Promise.resolve();
            });

        const binding = okBinding();
        const messages = [{ role: 'user', content: [{ type: 'text', text: 'build a model' }] }];
        const onToolResult = jest.fn();

        await runAgentLoop({
            binding,
            provider: 'anthropic',
            model: 'claude-opus-4-8',
            messages,
            tools: [],
            proxy,
            callbacks: { onToolResult }
        });

        expect(proxy.streamCompletion).toHaveBeenCalledTimes(2);
        expect(binding.execute).toHaveBeenCalledWith('addElement', { kind: 'process', name: 'API' });

        // user, assistant(tool_use), user(tool_result), assistant(final)
        expect(messages).toHaveLength(4);
        expect(messages[1].content.find((b) => b.type === 'tool_use').name).toBe('addElement');
        expect(messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: false });
        expect(messages[3].content[0]).toEqual({ type: 'text', text: 'All done.' });
        expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ name: 'addElement', ok: true }));
    });

    it('marks failed tool calls as is_error so the model can self-correct', async () => {
        const proxy = { streamCompletion: jest.fn() };
        proxy.streamCompletion
            .mockImplementationOnce((req, { onEvent }) => {
                onEvent({ type: 'tool_use_start', id: 't1', name: 'connectFlow' });
                onEvent({ type: 'tool_use_delta', partial_json: '{"sourceId":"x","targetId":"y"}' });
                return Promise.resolve();
            })
            .mockImplementationOnce(() => Promise.resolve());

        const binding = {
            execute: jest.fn((op) => (op === 'getModelSummary'
                ? Promise.resolve({ ok: true, result: {} })
                : Promise.resolve({ ok: false, error: 'No element found with id x' })))
        };
        const messages = [{ role: 'user', content: [{ type: 'text', text: 'connect' }] }];

        await runAgentLoop({ binding, provider: 'p', model: 'm', messages, tools: [], proxy });

        const toolResult = messages[2].content[0];
        expect(toolResult.is_error).toBe(true);
        expect(toolResult.content).toMatch(/No element found/);
    });

    it('does not stream when already aborted', async () => {
        const proxy = { streamCompletion: jest.fn() };
        const controller = new AbortController();
        controller.abort();
        const binding = okBinding();

        await runAgentLoop({
            binding,
            provider: 'p',
            model: 'm',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
            tools: [],
            proxy,
            signal: controller.signal
        });

        expect(proxy.streamCompletion).not.toHaveBeenCalled();
    });

    it('merges attachments into the last user message', async () => {
        const proxy = { streamCompletion: jest.fn().mockResolvedValue() };
        const binding = okBinding();
        const messages = [{ role: 'user', content: [{ type: 'text', text: 'use this doc' }] }];

        await runAgentLoop({
            binding,
            provider: 'p',
            model: 'm',
            messages,
            attachments: [{ kind: 'text', name: 'design.md', data: 'system design', mediaType: 'text/markdown' }],
            tools: [],
            proxy
        });

        const sent = proxy.streamCompletion.mock.calls[0][0];
        const userMsg = sent.messages[0];
        expect(userMsg.content[0].text).toMatch(/Attached document "design.md"/);
    });
});
