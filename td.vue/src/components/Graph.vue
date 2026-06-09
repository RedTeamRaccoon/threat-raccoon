<template>
    <div :class="{ 'td-graph-fullscreen': fullscreen }">
        <b-row>
            <b-col v-if="!fullscreen" md="2">
                <div ref="stencil_container"></div>
            </b-col>
            <b-col :md="fullscreen ? 12 : (panelOpen ? 7 : 10)">
                <b-row>
                    <b-col>
                        <h3 class="td-graph-title">{{ diagram.title }}</h3>
                    </b-col>
                    <b-col align="right">
                        <b-btn
                            v-if="aiEnabled && !fullscreen"
                            :pressed="panelOpen"
                            variant="secondary"
                            size="sm"
                            class="td-assistant-toggle mr-2"
                            :title="$t('assistant.toggle')"
                            @click="togglePanel"
                        >
                            <font-awesome-icon icon="robot" />
                        </b-btn>
                        <td-graph-buttons
                            :graph="graph"
                            :fullscreen="fullscreen"
                            @saved="saved"
                            @closed="closed"
                            @toggle-fullscreen="toggleFullscreen"
                        />
                    </b-col>
                </b-row>
                <b-row>
                    <b-col style="display: flex;    width: 100vw; ">
                        <div
                            id="graph-container"
                            ref="graph_container"
                            :style="containerStyle"
                        ></div>
                    </b-col>
                </b-row>
            </b-col>
            <b-col v-if="panelOpen && !fullscreen" md="3">
                <td-assistant-panel :graph="graph" @close="togglePanel" />
            </b-col>
        </b-row>

        <div
            v-if="!fullscreen"
            class="td-canvas-splitter"
            :title="$t('threatmodel.buttons.resizeCanvas')"
            @mousedown.prevent="startSplitterDrag"
        ></div>

        <td-graph-meta v-if="!fullscreen" @threatSelected="threatSelected" @threatSuggest="threatSuggest" />

        <td-graph-context-menu
            :visible="contextMenu.visible"
            :x="contextMenu.x"
            :y="contextMenu.y"
            @action="onZorderAction"
        />

        <div>
            <td-keyboard-shortcuts />
            <td-threat-edit-dialog ref="threatEditDialog" />
            <td-threat-suggest-dialog ref="threatSuggestDialog" />
            <td-assistant-settings v-if="aiEnabled" />
        </div>
    </div>
</template>

<style lang="scss" scoped>
.td-graph-title {
    margin-right: 15px;
}

// draggable handle that resizes the canvas height vs. the panels below it
.td-canvas-splitter {
    height: 10px;
    margin: 4px 0;
    cursor: row-resize;
    background: var(--td-surface-raised, #f5f5f5);
    border-top: 1px solid var(--td-border, #dee2e6);
    border-bottom: 1px solid var(--td-border, #dee2e6);
}

.td-canvas-splitter::after {
    content: '';
    display: block;
    width: 40px;
    height: 2px;
    margin: 4px auto 0;
    background: var(--td-text-muted, #6c757d);
    border-radius: 1px;
}

// fullscreen: the editor fills the window and the surrounding chrome is hidden
.td-graph-fullscreen {
    position: fixed;
    inset: 0;
    z-index: 1040;
    padding: 8px 16px;
    overflow: auto;
    background: var(--td-bg, #ffffff);
}
</style>

<script>
import { mapState } from 'vuex';

import TdAssistantPanel from '@/components/Assistant/AssistantPanel.vue';
import TdAssistantSettings from '@/components/Assistant/AssistantSettings.vue';
import TdGraphButtons from '@/components/GraphButtons.vue';
import TdGraphContextMenu from '@/components/GraphContextMenu.vue';
import TdGraphMeta from '@/components/GraphMeta.vue';
import TdKeyboardShortcuts from '@/components/KeyboardShortcuts.vue';
import TdThreatEditDialog from '@/components/ThreatEditDialog.vue';
import TdThreatSuggestDialog from './ThreatSuggestDialog.vue';
import assistantActions from '@/store/actions/assistant.js';
import zorder from '@/service/x6/zorder.js';

import { DESKTOP_DIAGRAM_SAVE_REQUEST_EVENT } from '@/service/desktop/save.js';
import { getProviderType } from '@/service/provider/providers.js';
import { providerTypes } from '@/service/provider/providerTypes.js';
import diagramService from '@/service/diagram/diagram.js';
import saveDiagram from '@/service/diagram/save.js';
import stencil from '@/service/x6/stencil.js';
import tmActions from '@/store/actions/threatmodel.js';

export default {
    name: 'TdGraph',
    components: {
        TdAssistantPanel,
        TdAssistantSettings,
        TdGraphButtons,
        TdGraphContextMenu,
        TdGraphMeta,
        TdKeyboardShortcuts,
        TdThreatEditDialog,
        TdThreatSuggestDialog
    },
    computed: {
        ...mapState({
            diagram: (state) => state.threatmodel.selectedDiagram,
            providerType: (state) => getProviderType(state.provider.selected),
            panelOpen: (state) => !!(state.assistant && state.assistant.panelOpen)
        }),
        aiEnabled() {
            // desktop is BYO-key (no backend /api/config), so the assistant is always
            // available there; server mode gates on the llmEnabled config flag.
            if (this.providerType === providerTypes.desktop) {
                return true;
            }
            const cfg = (this.$store.state.config && this.$store.state.config.config) || {};
            return !!cfg.llmEnabled;
        },
        containerStyle() {
            const height = this.fullscreen ? 'calc(100vh - 70px)' : `${this.canvasHeight}px`;
            return { height, width: '100%', flex: 1 };
        }
    },
    data() {
        return {
            graph: null,
            desktopSaveRequestHandler: null,
            fullscreen: false,
            canvasHeight: this.readStoredCanvasHeight(),
            splitterStartY: 0,
            splitterStartHeight: 0,
            contextMenu: { visible: false, x: 0, y: 0, cell: null }
        };
    },
    async mounted() {
        this.init();
        document.addEventListener('click', this.hideContextMenu);
        if (this.providerType === providerTypes.desktop) {
            this.desktopSaveRequestHandler = () => this.handleDesktopSaveRequest();
            window.addEventListener(DESKTOP_DIAGRAM_SAVE_REQUEST_EVENT, this.desktopSaveRequestHandler);
        }
    },
    methods: {
        init() {
            this.graph = diagramService.edit(this.$refs.graph_container, this.diagram);
            stencil.get(this.graph, this.$refs.stencil_container);
            this.$store.dispatch(tmActions.notModified);
            this.graph.getPlugin('history').on('change', () => {
                const updated = Object.assign({}, this.diagram);
                updated.cells = this.graph.toJSON().cells;
                this.$store.dispatch(tmActions.diagramModified, updated);
            });
            this.graph.on('cell:contextmenu', this.onCellContextMenu);
        },
        readStoredCanvasHeight() {
            const stored = parseInt(localStorage.getItem('td-canvas-height'), 10);
            if (!Number.isNaN(stored) && stored > 0) {
                return stored;
            }
            return Math.round(window.innerHeight * 0.65);
        },
        resizeGraph() {
            this.$nextTick(() => {
                const el = this.$refs.graph_container;
                if (el && this.graph) {
                    this.graph.resize(el.offsetWidth, el.offsetHeight);
                }
            });
        },
        toggleFullscreen() {
            this.fullscreen = !this.fullscreen;
            this.resizeGraph();
        },
        startSplitterDrag(event) {
            this.splitterStartY = event.clientY;
            this.splitterStartHeight = this.canvasHeight;
            document.addEventListener('mousemove', this.onSplitterMove);
            document.addEventListener('mouseup', this.stopSplitterDrag);
        },
        onSplitterMove(event) {
            const delta = event.clientY - this.splitterStartY;
            const next = this.splitterStartHeight + delta;
            const max = window.innerHeight - 100;
            this.canvasHeight = Math.min(Math.max(next, 200), max);
        },
        stopSplitterDrag() {
            document.removeEventListener('mousemove', this.onSplitterMove);
            document.removeEventListener('mouseup', this.stopSplitterDrag);
            localStorage.setItem('td-canvas-height', this.canvasHeight);
            this.resizeGraph();
        },
        onCellContextMenu({ e, cell }) {
            // z-order applies to component nodes only (boundaries stay pinned behind)
            if (!cell.isNode() || cell.shape === 'trust-boundary-box') {
                return;
            }
            this.contextMenu = {
                visible: true,
                x: e.clientX,
                y: e.clientY,
                cell
            };
        },
        hideContextMenu() {
            if (this.contextMenu.visible) {
                this.contextMenu = { visible: false, x: 0, y: 0, cell: null };
            }
        },
        onZorderAction(action) {
            const cell = this.contextMenu.cell;
            if (cell && zorder[action]) {
                zorder[action](this.graph, cell);
            }
            this.hideContextMenu();
        },
        threatSelected(threatId, state) {
            this.$refs.threatEditDialog.editThreat(threatId, state);
        },
        threatSuggest(type){
            this.$refs.threatSuggestDialog.showModal(type);
        },
        togglePanel() {
            this.$store.dispatch(assistantActions.togglePanel);
        },
        handleDesktopSaveRequest() {
            if (!this.graph) {
                return;
            }

            saveDiagram.save(this.$store, this.graph, this.diagram);
        },
        saved() {
            console.debug('Save diagram');
            saveDiagram.save(this.$store, this.graph, this.diagram);
        },
        async closed() {
            if (!this.$store.getters.modelChanged || await this.getConfirmModal()) {
                await this.$store.dispatch(tmActions.diagramClosed);
                this.$router.push({ name: `${this.providerType}ThreatModel`, params: this.$route.params });
            }
        },
        getConfirmModal() {
            return this.$bvModal.msgBoxConfirm(this.$t('forms.discardMessage'), {
                title: this.$t('forms.discardTitle'),
                okVariant: 'danger',
                okTitle: this.$t('forms.ok'),
                cancelTitle: this.$t('forms.cancel'),
                hideHeaderClose: true,
                centered: true
            });
        }
    },
    unmounted() {
        document.removeEventListener('click', this.hideContextMenu);
        document.removeEventListener('mousemove', this.onSplitterMove);
        document.removeEventListener('mouseup', this.stopSplitterDrag);
        if (this.desktopSaveRequestHandler) {
            window.removeEventListener(DESKTOP_DIAGRAM_SAVE_REQUEST_EVENT, this.desktopSaveRequestHandler);
        }
        diagramService.dispose(this.graph);
    }
};
</script>
