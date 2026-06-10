<template>
    <div></div>
</template>

<script>
import { mapState } from 'vuex';

import isElectron from 'is-electron';
import { getProviderType } from '@/service/provider/providers.js';
import tmActions from '@/store/actions/threatmodel.js';

export default {
    name: 'NewThreatModel',
    computed: mapState({
        providerType: (state) => getProviderType(state.provider.selected),
        version: (state) => state.packageBuildVersion,
        currentModel: (state) => state.threatmodel.data
    }),
    mounted() {
        let newTm;

        // Check if there's already a model loaded (from template/demo selection)
        if (this.currentModel && Object.keys(this.currentModel).length > 0) {
            newTm = this.currentModel;
            console.debug('Using existing model from state');
        } else {
            this.$store.dispatch(tmActions.clear);
            // Create blank model
            newTm = {
                version: this.version,
                summary: {
                    title: 'New Threat Model',
                    owner: '',
                    description: '',
                    id: 0
                },
                detail: {
                    contributors: [],
                    diagrams: [],
                    diagramTop: 0,
                    reviewer: '',
                    threatTop: 0
                }
            };
        }

        // select the model
        this.$store.dispatch(tmActions.selected, newTm);

        const params = Object.assign({}, this.$route.params, {
            threatmodel: newTm.summary.title
        });
        if (isElectron()) {
            // tell the desktop server that the model has changed
            window.electronAPI.modelOpened(newTm.summary.title);
        }
        const withAssistant = !!(this.$route.query && this.$route.query.assistant);
        if (this.providerType === 'local' || this.providerType === 'desktop') {
            if (withAssistant) {
                // "create with AI" welcome tile: go straight to the model OVERVIEW
                // page with the assistant panel requested (?assistant=1)
                this.$router.push({ name: `${this.providerType}ThreatModel`, params, query: { assistant: '1' } });
            } else {
                this.$router.push({ name: `${this.providerType}ThreatModelEdit`, params });
            }
        } else {
            this.$router.push({ name: `${this.providerType}ThreatModelCreate`, params });
        }
    }
};
</script>