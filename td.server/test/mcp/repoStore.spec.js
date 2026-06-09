import { expect } from 'chai';
import sinon from 'sinon';

import { createRepoStore } from '../../src/mcp/stores/repoStore.js';
import repositories from '../../src/repositories';

describe('mcp/stores/repoStore.js', () => {
    const modelInfo = { organisation: 'org', repo: 'repo', branch: 'main', model: 'tm' };
    let repository;

    beforeEach(() => {
        repository = {
            modelAsync: sinon.stub(),
            updateAsync: sinon.stub().resolves({ ok: true })
        };
        sinon.stub(repositories, 'get').returns(repository);
    });

    afterEach(() => {
        sinon.restore();
    });

    it('loadModel base64-decodes the repository content', async () => {
        const model = { version: '2.0', summary: { title: 't' } };
        const encoded = Buffer.from(JSON.stringify(model), 'utf8').toString('base64');
        repository.modelAsync.resolves([{ content: encoded }]);

        const store = createRepoStore({ accessToken: 'token', modelInfo });
        const loaded = await store.loadModel();

        expect(repository.modelAsync.calledOnceWith(modelInfo, 'token')).to.be.true;
        expect(loaded).to.deep.equal(model);
    });

    it('saveModel calls updateAsync with the model in the body', async () => {
        const model = { version: '2.0' };
        const store = createRepoStore({ accessToken: 'token', modelInfo });
        await store.saveModel(model);

        expect(repository.updateAsync.calledOnce).to.be.true;
        const [arg, token] = repository.updateAsync.firstCall.args;
        expect(arg).to.deep.equal({ ...modelInfo, body: model });
        expect(token).to.equal('token');
    });
});
