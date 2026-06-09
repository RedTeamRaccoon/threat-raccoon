import { BootstrapVue } from 'bootstrap-vue';
import { shallowMount, createLocalVue } from '@vue/test-utils';
import Vuex from 'vuex';

import TdDropdown from '@/components/Dropdown.vue';
import TdFormButton from '@/components/FormButton.vue';
import TdGraphButtons from '@/components/GraphButtons.vue';
import layout from '@/service/x6/layout.js';

jest.mock('@/service/x6/layout.js', () => ({ autoLayout: jest.fn() }));

describe('components/GraphButtons.vue', () => {
    let btn, graph, localVue, wrapper, mockUndo, mockRedo, mockCanUndo, mockCanRedo;

    beforeEach(() => {
        localStorage.clear();
        mockUndo = jest.fn();
        mockRedo = jest.fn();
        mockCanUndo = jest.fn().mockReturnValue(true);
        mockCanRedo = jest.fn().mockReturnValue(true);
        graph = {
            history: {},
            getPlugin: (name) => {
                if (name === 'history') {
                    return {
                        canUndo: mockCanUndo,
                        canRedo: mockCanRedo,
                        undo: mockUndo,
                        redo: mockRedo
                    };
                }
            }
        };
        localVue = createLocalVue();
        localVue.use(BootstrapVue);
        localVue.use(Vuex);
        wrapper = shallowMount(TdGraphButtons, {
            localVue,
            mocks: {
                $t: (t) => t
            },
            propsData: {
                graph
            },
            store: new Vuex.Store({
                state: {
                    provider: {
                        selected: 'github'
                    }
                }
            })
        });
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    const getButtonByIcon = (icon) =>
        wrapper
            .findAllComponents(TdFormButton)
            .filter((x) => x.attributes('icon') === icon)
            .at(0);

    describe('save', () => {
        beforeEach(() => {
            btn = getButtonByIcon('save');
            wrapper.vm.save();
        });

        it('has the save translation text', () => {
            expect(btn.attributes('text')).toEqual('forms.save');
        });
    });

    describe('close', () => {
        beforeEach(() => {
            btn = getButtonByIcon('times');
            wrapper.vm.closeDiagram();
        });

        it('has the save translation text', () => {
            expect(btn.attributes('text')).toEqual('forms.close');
        });
    });

    describe('keyboard shortcuts', () => {
        beforeEach(() => {
            btn = getButtonByIcon('keyboard');
        });

        it('does not have any text', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        it('is a noOp', () => {
            expect(() => wrapper.vm.noOp()).not.toThrow();
        });
    });

    describe('undo', () => {
        beforeEach(() => {
            btn = getButtonByIcon('undo');
        });

        it('does not have any text', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        describe('graph can undo', () => {
            beforeEach(() => {
                wrapper.vm.undo();
            });

            it('calls undo', () => {
                expect(mockUndo).toHaveBeenCalledTimes(1);
            });
        });

        describe('graph cannot undo', () => {
            beforeEach(() => {
                mockCanUndo = jest.fn().mockReturnValue(false);
                wrapper.vm.undo();
            });

            it('does not call undo', () => {
                expect(mockUndo).not.toHaveBeenCalled();
            });
        });
    });

    describe('redo', () => {
        beforeEach(() => {
            btn = getButtonByIcon('redo');
        });

        it('does not have any text', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        describe('graph can redo', () => {
            beforeEach(() => {
                wrapper.vm.redo();
            });

            it('calls redo', () => {
                expect(mockRedo).toHaveBeenCalledTimes(1);
            });
        });

        describe('graph cannot redo', () => {
            beforeEach(() => {
                mockCanRedo = jest.fn().mockReturnValue(false);
                wrapper.vm.redo();
            });

            it('calls redo', () => {
                expect(mockRedo).not.toHaveBeenCalled();
            });
        });
    });

    describe('zoom in', () => {
        beforeEach(() => {
            btn = getButtonByIcon('search-plus');
        });

        it('does not have any text', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        it('zooms in the graph', () => {
            graph.zoom = jest.fn();
            wrapper.vm.zoomIn();
            expect(graph.zoom).toHaveBeenCalledWith(0.2);
        });
    });

    describe('zoom out', () => {
        beforeEach(() => {
            btn = getButtonByIcon('search-minus');
        });

        it('does not have any text', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        it('zooms out the graph', () => {
            graph.zoom = jest.fn();
            wrapper.vm.zoomOut();
            expect(graph.zoom).toHaveBeenCalledWith(-0.2);
        });
    });

    describe('delete', () => {
        beforeEach(() => {
            btn = getButtonByIcon('trash');
        });

        it('does not have any text', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        it('removes the selected cells', () => {
            graph.getSelectedCells = jest.fn();
            graph.removeCells = jest.fn();
            wrapper.vm.deleteSelected();
            expect(graph.getSelectedCells).toHaveBeenCalled();
            expect(graph.removeCells).toHaveBeenCalled();
        });
    });

    describe('toggle grid', () => {
        beforeEach(() => {
            btn = getButtonByIcon('th');
        });

        it('does not have any text', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        describe('hide', () => {
            beforeEach(() => {
                graph.hideGrid = jest.fn();
                graph.showGrid = jest.fn();
                wrapper.vm.toggleGrid();
            });

            it('hides the grid', () => {
                expect(graph.hideGrid).toHaveBeenCalledTimes(1);
            });

            describe('show', () => {
                it('shows the grid', () => {
                    wrapper.vm.toggleGrid();
                    expect(graph.showGrid).toHaveBeenCalledTimes(1);
                });
            });
        });
    });

    describe('toggle snap', () => {
        let mockEnable, mockDisable;

        beforeEach(() => {
            mockEnable = jest.fn();
            mockDisable = jest.fn();
            graph.getPlugin = jest.fn((name) =>
                name === 'snapline' ? { enable: mockEnable, disable: mockDisable } : undefined
            );
            btn = getButtonByIcon('magnet');
        });

        it('renders the snap toggle button', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        it('disables snapping when toggled off from the default on state', () => {
            wrapper.vm.toggleSnap();
            expect(mockDisable).toHaveBeenCalledTimes(1);
            expect(wrapper.vm.snapEnabled).toBe(false);
        });

        it('re-enables snapping when toggled back on', () => {
            wrapper.vm.toggleSnap();
            wrapper.vm.toggleSnap();
            expect(mockEnable).toHaveBeenCalled();
            expect(wrapper.vm.snapEnabled).toBe(true);
        });

        it('persists the preference to localStorage', () => {
            wrapper.vm.toggleSnap();
            expect(localStorage.getItem('td-snap-enabled')).toEqual('false');
        });
    });

    describe('auto-arrange', () => {
        beforeEach(() => {
            btn = getButtonByIcon('sitemap');
        });

        it('renders the auto-arrange button', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        it('runs the layout service on the graph', () => {
            wrapper.vm.autoArrange();
            expect(layout.autoLayout).toHaveBeenCalledWith(graph);
        });
    });

    describe('fullscreen', () => {
        beforeEach(() => {
            btn = getButtonByIcon('expand');
        });

        it('renders the fullscreen toggle button', () => {
            expect(btn.attributes('text')).toEqual('');
        });

        it('emits a toggle-fullscreen event', () => {
            wrapper.vm.toggleFullscreen();
            expect(wrapper.emitted('toggle-fullscreen')).toBeTruthy();
        });
    });

    describe('export', () => {
        beforeEach(() => {
            btn = wrapper
                .findAllComponents(TdDropdown)
                .filter((x) => x.attributes('id') === 'export-graph-btn')
                .at(0);
        });

        it('has the export translation text', () => {
            expect(btn.attributes('text')).toEqual('forms.export');
        });

        it('right aligns the export menu', () => {
            expect(btn.attributes('right')).toEqual('true');
        });

        it('uses the secondary variant', () => {
            expect(btn.attributes('variant')).toEqual('secondary');
        });

        it('has a dropdown item for PNG', () => {
            expect(btn.find('#export-graph-png').exists()).toBe(true);
        });

        it('has a dropdown item for SVG', () => {
            expect(btn.find('#export-graph-svg').exists()).toBe(true);
        });
    });
});
