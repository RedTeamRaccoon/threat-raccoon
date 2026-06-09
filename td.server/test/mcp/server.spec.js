import { expect } from 'chai';
import sinon from 'sinon';

import {
    makeCallToolHandler,
    makeListToolsHandler,
    makeListPromptsHandler,
    makeGetPromptHandler,
    PROMPT_DEFS
} from '../../src/mcp/server.js';

describe('mcp/server.js', () => {
    describe('makeListToolsHandler', () => {
        it('maps tmcore toolDefinitions to MCP tool descriptors', async () => {
            const handler = makeListToolsHandler([
                { name: 'addElement', description: 'add an element', input_schema: { type: 'object' } }
            ]);
            const result = await handler();
            expect(result).to.deep.equal({
                tools: [{ name: 'addElement', description: 'add an element', inputSchema: { type: 'object' } }]
            });
        });
    });

    describe('makeCallToolHandler', () => {
        let modelStore;
        let ops;

        beforeEach(() => {
            modelStore = {
                loadModel: sinon.stub().resolves({ version: '2.0' }),
                saveModel: sinon.stub().resolves()
            };
            ops = {
                addThreat: sinon.stub().returns({ model: { version: '2.0', touched: true }, result: { threatId: 't1', number: 1 } }),
                listThreats: sinon.stub().returns({ model: { version: '2.0' }, result: { threats: [] } })
            };
        });

        it('runs a mutating op and persists the new model', async () => {
            const handler = makeCallToolHandler({ ops, modelStore });
            const result = await handler({ params: { name: 'addThreat', arguments: { diagramId: 1, cellId: 'c1', threat: {} } } });

            expect(ops.addThreat.calledOnce).to.be.true;
            expect(modelStore.saveModel.calledOnceWith({ version: '2.0', touched: true })).to.be.true;
            expect(result.content[0].text).to.equal(JSON.stringify({ threatId: 't1', number: 1 }));
        });

        it('does not persist after a read-only op', async () => {
            const handler = makeCallToolHandler({ ops, modelStore });
            const result = await handler({ params: { name: 'listThreats', arguments: {} } });

            expect(ops.listThreats.calledOnce).to.be.true;
            expect(modelStore.saveModel.called).to.be.false;
            expect(result.content[0].text).to.equal(JSON.stringify({ threats: [] }));
        });

        it('returns an error result for an unknown tool', async () => {
            const handler = makeCallToolHandler({ ops, modelStore });
            const result = await handler({ params: { name: 'nope', arguments: {} } });

            expect(result.isError).to.be.true;
            expect(modelStore.loadModel.called).to.be.false;
        });

        it('returns an error result when the op throws', async () => {
            ops.addThreat.throws(new Error('invalid model'));
            const handler = makeCallToolHandler({ ops, modelStore });
            const result = await handler({ params: { name: 'addThreat', arguments: {} } });

            expect(result.isError).to.be.true;
            expect(result.content[0].text).to.equal('invalid model');
            expect(modelStore.saveModel.called).to.be.false;
        });
    });

    describe('prompt handlers', () => {
        it('lists the build_threat_model and review_coverage prompts', () => {
            const result = makeListPromptsHandler()();
            const names = result.prompts.map((p) => p.name);
            expect(names).to.include('build_threat_model');
            expect(names).to.include('review_coverage');
            expect(PROMPT_DEFS.find((p) => p.name === 'build_threat_model').arguments[0].name)
                .to.equal('system_description');
        });

        it('builds the build_threat_model prompt from the system_description', () => {
            const tmcore = {
                buildModelTask: sinon.stub().returns('BUILD TASK'),
                reviewCoverageTask: sinon.stub().returns('REVIEW TASK')
            };
            const result = makeGetPromptHandler(tmcore)({
                params: { name: 'build_threat_model', arguments: { system_description: 'My app' } }
            });
            expect(tmcore.buildModelTask.calledOnceWith('My app')).to.be.true;
            expect(result.messages[0]).to.deep.equal({ role: 'user', content: { type: 'text', text: 'BUILD TASK' } });
        });

        it('builds the review_coverage prompt', () => {
            const tmcore = { buildModelTask: sinon.stub(), reviewCoverageTask: sinon.stub().returns('REVIEW TASK') };
            const result = makeGetPromptHandler(tmcore)({ params: { name: 'review_coverage' } });
            expect(tmcore.reviewCoverageTask.calledOnce).to.be.true;
            expect(result.messages[0].content.text).to.equal('REVIEW TASK');
        });

        it('throws for an unknown prompt', () => {
            const handler = makeGetPromptHandler({});
            expect(() => handler({ params: { name: 'nope' } })).to.throw(/Unknown prompt/);
        });
    });
});
