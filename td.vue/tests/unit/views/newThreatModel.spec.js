import { shallowMount, createLocalVue } from '@vue/test-utils';
import Vuex from 'vuex';

import NewThreatModel from '@/views/NewThreatModel.vue';

describe('NewThreatModel.vue', () => {
    let localVue, mockStore, router;

    describe('local provider', () => {
        beforeEach(() => {
            localVue = createLocalVue();
            localVue.use(Vuex);
            mockStore = new Vuex.Store({
                state: {
                    provider: { selected: 'local' },
                    threatmodel: { data: {} },
                    packageBuildVersion: '2.0.0'
                },
                actions: {
                    'THREATMODEL_CLEAR': () => {},
                    'THREATMODEL_SELECTED': () => {}
                }
            });
            jest.spyOn(mockStore, 'dispatch');
            router = { push: jest.fn() };
            shallowMount(NewThreatModel, {
                localVue,
                store: mockStore,
                mocks: {
                    $router: router,
                    $route: {
                        params: { foo: 'bar' }
                    }
                }
            });
        });

        it('clears the current threat model', () => {
            expect(mockStore.dispatch).toHaveBeenCalledWith('THREATMODEL_CLEAR');
        });

        it('selects the new threatModel', () => {
            expect(mockStore.dispatch).toHaveBeenCalledWith('THREATMODEL_SELECTED', expect.anything());
        });

        it('navigates to the edit page', () => {
            expect(router.push).toHaveBeenCalledWith({
                name: 'localThreatModelEdit',
                params: {
                    foo: 'bar',
                    threatmodel: 'New Threat Model'
                }
            });
        });
    });

    describe('local provider with the assistant query (create with AI tile)', () => {
        beforeEach(() => {
            localVue = createLocalVue();
            localVue.use(Vuex);
            mockStore = new Vuex.Store({
                state: {
                    provider: { selected: 'local' },
                    threatmodel: { data: {} },
                    packageBuildVersion: '2.0.0'
                },
                actions: {
                    'THREATMODEL_CLEAR': () => {},
                    'THREATMODEL_SELECTED': () => {}
                }
            });
            jest.spyOn(mockStore, 'dispatch');
            router = { push: jest.fn() };
            shallowMount(NewThreatModel, {
                localVue,
                store: mockStore,
                mocks: {
                    $router: router,
                    $route: {
                        params: { foo: 'bar' },
                        query: { assistant: '1' }
                    }
                }
            });
        });

        it('navigates to the model overview page keeping the assistant query', () => {
            expect(router.push).toHaveBeenCalledWith({
                name: 'localThreatModel',
                params: {
                    foo: 'bar',
                    threatmodel: 'New Threat Model'
                },
                query: { assistant: '1' }
            });
        });
    });

    describe('git provider', () => {
        beforeEach(() => {
            localVue = createLocalVue();
            localVue.use(Vuex);
            mockStore = new Vuex.Store({
                state: {
                    provider: { selected: 'github' },
                    threatmodel: { data: {} },
                    packageBuildVersion: '2.0.0'
                },
                actions: {
                    'THREATMODEL_CLEAR': () => {},
                    'THREATMODEL_SELECTED': () => {}
                }
            });
            jest.spyOn(mockStore, 'dispatch');
            router = { push: jest.fn() };
            shallowMount(NewThreatModel, {
                localVue,
                store: mockStore,
                mocks: {
                    $router: router,
                    $route: {
                        params: { foo: 'bar' }
                    }
                }
            });
        });

        it('clears the current threat model', () => {
            expect(mockStore.dispatch).toHaveBeenCalledWith('THREATMODEL_CLEAR');
        });

        it('selects the new threatModel', () => {
            expect(mockStore.dispatch).toHaveBeenCalledWith('THREATMODEL_SELECTED', expect.anything());
        });

        it('navigates to the edit page for creation', () => {
            expect(router.push).toHaveBeenCalledWith({
                name: 'gitThreatModelCreate',
                params: {
                    foo: 'bar',
                    threatmodel: 'New Threat Model'
                }
            });
        });
    });
});
