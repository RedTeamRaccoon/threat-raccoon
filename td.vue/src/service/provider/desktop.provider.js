import { providerTypes } from './providerTypes.js';

const providerType = providerTypes.desktop;

const getDashboardActions = () => ([
    {
        to: `/${providerType}/threatmodel/new?assistant=1`,
        key: 'createWithAI',
        icon: 'robot'
    },
    {
        to: `/${providerType}/threatmodel/import`,
        key: 'openExisting',
        icon: 'file-import'
    },
    {
        to: `/${providerType}/threatmodel/new`,
        key: 'createNew',
        icon: 'plus'
    },
    {
        to: '/demo/select',
        key: 'readDemo',
        icon: 'cloud-download-alt'
    }
]);

export default {
    getDashboardActions
};
