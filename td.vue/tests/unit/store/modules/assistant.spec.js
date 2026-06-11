import {
    ASSISTANT_SECTION_PROGRESS,
    ASSISTANT_SEND,
    ASSISTANT_SET_ERROR,
    ASSISTANT_SET_RUN_STATE
} from '@/store/actions/assistant.js';
import assistantModule, { pruneIngestedSection } from '@/store/modules/assistant.js';
import { runAgentLoop } from '@/service/assistant/agentLoop.js';

jest.mock('@/service/assistant/agentLoop.js', () => ({ runAgentLoop: jest.fn() }));

const omissionStub = (index, total, name) =>
    `[Section ${index}/${total} of "${name}" omitted - already incorporated into the threat model.]`;

// the prune threshold is 50_000: anything longer is raw document text
const bigText = (fill) => fill.repeat(60000);

describe('store/modules/assistant.js', () => {
    // a commit spy that also APPLIES the real mutations, so the action's reads
    // of state (error, messages) behave like they do against the live store
    const buildContext = (attachments = []) => {
        const state = {
            panelOpen: false,
            provider: 'anthropic',
            model: 'test-model',
            messages: [],
            streaming: false,
            streamingText: '',
            pendingToolCalls: [],
            runState: 'idle',
            attachments,
            error: null,
            abortRequested: false,
            sectionProgress: null
        };
        const commit = jest.fn((type, payload) => {
            if (assistantModule.mutations[type]) {
                assistantModule.mutations[type](state, payload);
            }
        });
        return { commit, state };
    };

    const send = (context, overrides = {}) => assistantModule.actions[ASSISTANT_SEND](context, {
        text: 'build a threat model',
        binding: { execute: jest.fn() },
        signal: undefined,
        systemContext: undefined,
        ...overrides
    });

    const chunkedAttachments = () => [{
        kind: 'text',
        mediaType: 'text/plain',
        name: 'spec.pdf',
        group: 'spec.pdf',
        data: bigText('x'),
        pendingSections: [
            { index: 2, total: 3, pageRange: '4-6', text: bigText('y') },
            { index: 3, total: 3, pageRange: '7-9', text: 'short final section' }
        ]
    }];

    describe('pruneIngestedSection', () => {
        it('replaces only the bulky user text block with the omission stub', () => {
            const keep = 'please model this design';
            const messages = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: `Attached document "spec.pdf":\n\n${bigText('x')}` },
                        { type: 'text', text: keep }
                    ]
                },
                { role: 'assistant', content: [{ type: 'text', text: bigText('a') }] }
            ];

            const pruned = pruneIngestedSection(messages, { index: 1, total: 3, name: 'spec.pdf' });

            expect(pruned).toBe(true);
            expect(messages[0].content[0].text).toBe(omissionStub(1, 3, 'spec.pdf'));
            expect(messages[0].content[1].text).toBe(keep);
            // assistant turns are never pruned, however long
            expect(messages[1].content[0].text).toBe(bigText('a'));
        });

        it('leaves the conversation alone when nothing is bulky', () => {
            const messages = [{ role: 'user', content: [{ type: 'text', text: 'small' }] }];
            expect(pruneIngestedSection(messages, { index: 1, total: 2, name: 'a.pdf' })).toBe(false);
            expect(messages[0].content[0].text).toBe('small');
        });
    });

    describe('ASSISTANT_SEND', () => {
        it('runs the agent loop once when there are no pending sections', async () => {
            const context = buildContext();
            runAgentLoop.mockResolvedValue([]);

            await send(context);

            expect(runAgentLoop).toHaveBeenCalledTimes(1);
            const progress = context.commit.mock.calls.filter(([type]) => type === ASSISTANT_SECTION_PROGRESS);
            // only the final reset, never a { current, total } progress value
            expect(progress).toEqual([[ASSISTANT_SECTION_PROGRESS, null]]);
            expect(context.state.runState).toBe('idle');
        });

        it('feeds pending sections sequentially, pruning the previous section first', async () => {
            const context = buildContext(chunkedAttachments());
            runAgentLoop.mockImplementation(async ({ messages, attachments }) => {
                // simulate agentLoop merging attachments into the last user turn
                if (attachments && attachments.length) {
                    const last = messages[messages.length - 1];
                    last.content.unshift({
                        type: 'text',
                        text: `Attached document "spec.pdf":\n\n${attachments[0].data}`
                    });
                }
                return messages;
            });

            await send(context);

            // 1 initial run + one per pending section, all on the SAME conversation
            expect(runAgentLoop).toHaveBeenCalledTimes(3);
            const calls = runAgentLoop.mock.calls.map(([options]) => options);
            expect(calls[1].messages).toBe(calls[0].messages);
            expect(calls[2].messages).toBe(calls[0].messages);
            // attachments only ride on the FIRST request
            expect(calls[0].attachments).toHaveLength(1);
            expect(calls[1].attachments).toBeUndefined();
            expect(calls[2].attachments).toBeUndefined();

            const working = calls[0].messages;
            const texts = working.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
                .filter((b) => b.type === 'text').map((b) => b.text);
            // sections 1 and 2 were pruned once incorporated; section 3 stays
            expect(texts).toContain(omissionStub(1, 3, 'spec.pdf'));
            expect(texts).toContain(omissionStub(2, 3, 'spec.pdf'));
            const section3 = texts.find((t) => t.includes('section 3/3 (pages 7-9)'));
            expect(section3).toContain('Continuing the attached document "spec.pdf"');
            expect(section3).toContain('short final section');
            expect(section3).toContain('the current model state is in your system prompt');
            // no raw section text is left in the conversation
            expect(texts.some((t) => t.length > 50000)).toBe(false);

            // progress was reported per section, then cleared
            const progress = context.commit.mock.calls
                .filter(([type]) => type === ASSISTANT_SECTION_PROGRESS)
                .map(([, payload]) => payload);
            expect(progress).toEqual([
                { current: 2, total: 3, name: 'spec.pdf' },
                { current: 3, total: 3, name: 'spec.pdf' },
                null
            ]);
            expect(context.state.sectionProgress).toBeNull();

            // run state reset exactly once, at the very end
            const idleCommits = context.commit.mock.calls
                .filter(([type, payload]) => type === ASSISTANT_SET_RUN_STATE && payload === 'idle');
            expect(idleCommits).toHaveLength(1);
        });

        it('stops the remaining sections when the signal aborts', async () => {
            const context = buildContext(chunkedAttachments());
            const signal = { aborted: false };
            runAgentLoop.mockImplementation(async () => {
                // user pressed Stop during the first run
                signal.aborted = true;
            });

            await send(context, { signal });

            expect(runAgentLoop).toHaveBeenCalledTimes(1);
            const progress = context.commit.mock.calls.filter(([type]) => type === ASSISTANT_SECTION_PROGRESS);
            expect(progress).toEqual([[ASSISTANT_SECTION_PROGRESS, null]]);
            expect(context.state.error).toBeNull();
            expect(context.state.runState).toBe('idle');
        });

        it('stops the remaining sections when a section run fails', async () => {
            const context = buildContext(chunkedAttachments());
            runAgentLoop
                .mockResolvedValueOnce([])
                .mockRejectedValueOnce(new Error('boom'));

            await send(context);

            // first run + section 2 (which failed); section 3 never sent
            expect(runAgentLoop).toHaveBeenCalledTimes(2);
            expect(context.commit).toHaveBeenCalledWith(ASSISTANT_SET_ERROR, 'boom');
            expect(context.state.sectionProgress).toBeNull();
            expect(context.state.runState).toBe('idle');
        });

        it('does not surface an abort as an error', async () => {
            const context = buildContext();
            const abortError = new Error('aborted');
            abortError.name = 'AbortError';
            runAgentLoop.mockRejectedValue(abortError);

            await send(context);

            expect(context.state.error).toBeNull();
            expect(context.state.runState).toBe('idle');
        });
    });
});
