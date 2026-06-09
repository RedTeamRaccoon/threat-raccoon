import { expect } from 'chai';
import sinon from 'sinon';

import { makeCallToolHandler, makeListToolsHandler } from '../../src/mcp/server.js';

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
});
