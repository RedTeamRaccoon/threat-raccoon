/**
 * @name repoStore
 * @description Repo-backed model store for the server-mode MCP server. Loads and
 * saves a threat model through the existing storage repositories exactly as
 * threatmodelcontroller does (base64-decode on load, updateAsync on save). The
 * target model + access token are bound from the authenticated request — never
 * supplied by the MCP client at tool-call time.
 */
import repositories from '../../repositories';

/**
 * @param {Object} args
 * @param {String} args.accessToken provider access token from the authenticated request
 * @param {Object} args.modelInfo { organisation, repo, branch, model }
 * @returns {{ loadModel: Function, saveModel: Function }}
 */
export const createRepoStore = ({ accessToken, modelInfo }) => {
    const loadModel = async () => {
        const repository = repositories.get();
        const modelResp = await repository.modelAsync(modelInfo, accessToken);
        return JSON.parse(Buffer.from(modelResp[0].content, 'base64').toString('utf8'));
    };

    const saveModel = (model) => {
        const repository = repositories.get();
        return repository.updateAsync({ ...modelInfo, body: model }, accessToken);
    };

    return { loadModel, saveModel };
};

export default { createRepoStore };
