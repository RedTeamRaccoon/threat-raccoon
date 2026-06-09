import VuexPersistence from 'vuex-persist';

const session = new VuexPersistence({
    key: 'td.vuex',
    storage: window.sessionStorage,
    // Never persist the assistant module: chat transcripts, attachments and any
    // per-user keys must not be written to sessionStorage.
    reducer: (state) => {
        // eslint-disable-next-line no-unused-vars
        const { assistant, ...persisted } = state;
        return persisted;
    }
});

export default {
    session
};
