import { runAgentLoop, MAX_ITERATIONS } from '@/service/assistant/agentLoop.js';

const okBinding = (impl) => ({
    execute: jest.fn(impl || (() => Promise.resolve({ ok: true, result: { cellId: 'c1' } })))
});

// a stream turn that always asks for one tool call (so the loop never stops on
// its own) — used to exercise the iteration cap
const alwaysToolStream = (req, { onEvent }) => {
    onEvent({ type: 'tool_use_start', id: `t${Math.random()}`, name: 'addElement' });
    onEvent({ type: 'tool_use_delta', partial_json: '{"kind":"process","name":"X"}' });
    return Promise.resolve();
};

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

    describe('default iteration cap', () => {
        it('defaults MAX_ITERATIONS to 50', () => {
            expect(MAX_ITERATIONS).toBe(50);
        });
    });

    describe('iteration cap', () => {
        it('stops at maxIterations, fires onLimit, and leaves a resumable conversation', async () => {
            const proxy = { streamCompletion: jest.fn(alwaysToolStream) };
            const binding = okBinding();
            const messages = [{ role: 'user', content: [{ type: 'text', text: 'build everything' }] }];
            const onLimit = jest.fn();

            await runAgentLoop({
                binding, provider: 'p', model: 'm', messages, tools: [], proxy,
                maxIterations: 3,
                callbacks: { onLimit }
            });

            // exactly maxIterations turns ran (the model kept wanting tools)
            expect(proxy.streamCompletion).toHaveBeenCalledTimes(3);
            // the cap was surfaced, NOT silently swallowed
            expect(onLimit).toHaveBeenCalledTimes(1);
            expect(onLimit).toHaveBeenCalledWith({ count: 3 });

            // resumable: the conversation ends on a tool_result (user) turn and
            // every tool_use has a matching tool_result
            const last = messages[messages.length - 1];
            expect(last.role).toBe('user');
            expect(last.content[0].type).toBe('tool_result');
            const toolUseIds = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
                .filter((b) => b.type === 'tool_use').map((b) => b.id);
            const resultIds = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
                .filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
            expect(resultIds.sort()).toEqual(toolUseIds.sort());
        });

        it('does not fire onLimit when the model finishes before the cap', async () => {
            const proxy = { streamCompletion: jest.fn() };
            proxy.streamCompletion.mockImplementationOnce((req, { onEvent }) => {
                onEvent({ type: 'text_delta', text: 'done' });
                return Promise.resolve();
            });
            const onLimit = jest.fn();

            await runAgentLoop({
                binding: okBinding(),
                provider: 'p', model: 'm',
                messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
                tools: [], proxy, maxIterations: 5, callbacks: { onLimit }
            });

            expect(onLimit).not.toHaveBeenCalled();
        });
    });

    describe('max_tokens (output truncation) handling', () => {
        it('drops a truncated tool call and auto-continues once', async () => {
            const proxy = { streamCompletion: jest.fn() };
            proxy.streamCompletion
                // turn 1: a tool_use whose JSON args are cut off, stop_reason max_tokens
                .mockImplementationOnce((req, { onEvent }) => {
                    onEvent({ type: 'text_delta', text: 'Adding the API process' });
                    onEvent({ type: 'tool_use_start', id: 't1', name: 'addElement' });
                    onEvent({ type: 'tool_use_delta', partial_json: '{"kind":"proc' });
                    onEvent({ type: 'message_delta', stop_reason: 'max_tokens' });
                    return Promise.resolve();
                })
                // turn 2: the model resumes and finishes cleanly
                .mockImplementationOnce((req, { onEvent }) => {
                    onEvent({ type: 'text_delta', text: 'All done.' });
                    return Promise.resolve();
                });

            const binding = okBinding();
            const messages = [{ role: 'user', content: [{ type: 'text', text: 'add the API' }] }];

            await runAgentLoop({ binding, provider: 'p', model: 'm', messages, tools: [], proxy });

            // the truncated tool call must NOT be executed with empty args
            const executed = binding.execute.mock.calls.map(([op]) => op);
            expect(executed).not.toContain('addElement');

            // exactly one auto-continue happened
            expect(proxy.streamCompletion).toHaveBeenCalledTimes(2);

            // a continue note was appended as a user turn between the two turns
            const noteTurn = messages.find((m) => m.role === 'user'
                && Array.isArray(m.content)
                && m.content[0].type === 'text'
                && /cut off by the output limit/.test(m.content[0].text));
            expect(noteTurn).toBeDefined();

            // the truncated assistant turn carries only its text, no tool_use block
            const assistantTurn = messages.find((m) => m.role === 'assistant'
                && m.content.some((b) => b.type === 'text' && /Adding the API/.test(b.text)));
            expect(assistantTurn.content.some((b) => b.type === 'tool_use')).toBe(false);
        });

        it('keeps a COMPLETE tool call even when stop_reason is max_tokens', async () => {
            const proxy = { streamCompletion: jest.fn() };
            proxy.streamCompletion
                .mockImplementationOnce((req, { onEvent }) => {
                    onEvent({ type: 'tool_use_start', id: 't1', name: 'addElement' });
                    onEvent({ type: 'tool_use_delta', partial_json: '{"kind":"process","name":"API"}' });
                    onEvent({ type: 'message_delta', stop_reason: 'max_tokens' });
                    return Promise.resolve();
                })
                .mockImplementationOnce(() => Promise.resolve());

            const binding = okBinding();
            const messages = [{ role: 'user', content: [{ type: 'text', text: 'add' }] }];

            await runAgentLoop({ binding, provider: 'p', model: 'm', messages, tools: [], proxy });

            // a complete tool call parses fine and IS executed
            expect(binding.execute).toHaveBeenCalledWith('addElement', { kind: 'process', name: 'API' });
        });

        it('counts the truncation auto-continue against the iteration cap', async () => {
            const proxy = { streamCompletion: jest.fn() };
            // every turn truncates with no tool call -> would loop forever without
            // the cap; the cap must still bound it
            proxy.streamCompletion.mockImplementation((req, { onEvent }) => {
                onEvent({ type: 'text_delta', text: 'partial' });
                onEvent({ type: 'message_delta', stop_reason: 'max_tokens' });
                return Promise.resolve();
            });
            const onLimit = jest.fn();

            await runAgentLoop({
                binding: okBinding(),
                provider: 'p', model: 'm',
                messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
                tools: [], proxy, maxIterations: 4, callbacks: { onLimit }
            });

            expect(proxy.streamCompletion).toHaveBeenCalledTimes(4);
            expect(onLimit).toHaveBeenCalledWith({ count: 4 });
        });
    });
});
