<template>
    <div class="mt-5">
        <b-row>
            <b-col>
                <td-graph />
            </b-col>
        </b-row>
    </div>
</template>

<script>
import { mapState } from 'vuex';

import TdGraph from '@/components/Graph.vue';
import editorContextReporter from '@/service/assistant/editorContextReporter.js';

export default {
    name: 'DiagramEdit',
    components: {
        TdGraph
    },
    computed: mapState({
        selectedDiagram: (state) => state.threatmodel.selectedDiagram,
        modelTitle: (state) => {
            const data = state.threatmodel.data || {};
            return data.summary && data.summary.title;
        }
    }),
    watch: {
        // the selected diagram is set by the overview page before navigating here,
        // but report again if it becomes available late or changes while mounted
        selectedDiagram(diagram) {
            this.reportDiagramContext(diagram);
        }
    },
    mounted() {
        this.reportDiagramContext(this.selectedDiagram);
    },
    methods: {
        reportDiagramContext(diagram) {
            if (!diagram || diagram.id == null) {
                return;
            }
            editorContextReporter.report({
                page: 'diagram',
                modelTitle: this.modelTitle,
                diagramId: diagram.id,
                diagramTitle: diagram.title
            });
        }
    },
    unmounted() {
        // back to the model overview page
        editorContextReporter.report({ page: 'model', modelTitle: this.modelTitle });
    }
};

</script>
