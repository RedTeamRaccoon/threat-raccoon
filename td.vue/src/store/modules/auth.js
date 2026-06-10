import isElectron from 'is-electron';

import { AUTH_CLEAR, AUTH_SET_JWT, AUTH_SET_LOCAL, LOGOUT } from '../actions/auth.js';
import { BRANCH_CLEAR } from '../actions/branch.js';
import loginApi from '../../service/api/loginApi.js';
import { PROVIDER_CLEAR } from '../actions/provider.js';
import providers from '../../service/provider/providers.js';
import { REPOSITORY_CLEAR } from '../actions/repository.js';
import { THREATMODEL_CLEAR } from '../actions/threatmodel.js';

export const clearState = (state) => {
    state.jwt = '';
    state.refreshToken = '';
    state.jwtBody = {};
    state.user = {};
};

const state = {
    jwt: '',
    refreshToken: '',
    jwtBody: {},
    user: {}
};

const actions = {
    [AUTH_CLEAR]: ({ commit }) => commit(AUTH_CLEAR),
    [AUTH_SET_JWT]: ({ commit }, tokens) => commit(AUTH_SET_JWT, tokens),
    [AUTH_SET_LOCAL]: async ({ commit, rootState }) => {
        // When the server allows it (LLM_LOCAL_SESSION), back the local session
        // with a real JWT so JWT-gated features (the in-app assistant, HTTP MCP)
        // work without a Git provider login. Desktop has no server to ask.
        const config = rootState.config && rootState.config.config;
        if (config && config.llmLocalSession && !isElectron()) {
            try {
                const resp = await loginApi.loginAsync('local');
                commit(AUTH_SET_JWT, resp.data);
                return;
            } catch (e) {
                console.warn('Local session JWT was not available, continuing without one', e);
            }
        }
        commit(AUTH_SET_LOCAL);
    },
    [LOGOUT]: async ({ dispatch, state, rootState }) => {
        try {
            // a local session may hold a server-minted JWT; revoke whenever a
            // refresh token exists (desktop sessions never have one)
            if (state && state.refreshToken && rootState.provider.selected !== providers.allProviders.desktop.key) {
                await loginApi.logoutAsync(state.refreshToken);
            }
        } catch (e) {
            console.error('Error calling logout api', e);
        }
        dispatch(AUTH_CLEAR);
        dispatch(BRANCH_CLEAR);
        dispatch(PROVIDER_CLEAR);
        dispatch(REPOSITORY_CLEAR);
        dispatch(THREATMODEL_CLEAR);
    }
};

const mutations = {
    [AUTH_CLEAR]: (state) => clearState(state),
    [AUTH_SET_JWT]: (state, tokens) => {
        try {
            const { accessToken, refreshToken } = tokens;
            const tokenBody = accessToken.split('.')[1];
            const decodedBody = window.atob(tokenBody);
            const jwtBody = JSON.parse(decodedBody);
            state.jwt = accessToken;
            state.jwtBody = jwtBody;
            state.user = jwtBody.user;
            state.refreshToken = refreshToken;
        } catch (e) {
            console.error('Error decoding JWT', e);
            throw e;
        }
    },
    [AUTH_SET_LOCAL]: (state) => {
        state.user = {
            username: 'local-user'
        };
    }
};

const getters = {
    username: (state) => state.user.username || '',
    isAdmin: (state) => state.user.isAdmin || false
};

export default {
    state,
    actions,
    mutations,
    getters
};
