import local from '@/service/provider/local.provider.js';

describe('service/local.provider.js', () => {
    describe('getDashboardActions', () => {

        describe('create with AI', () => {
            let action;

            beforeEach(() => {
                action = local.getDashboardActions().find(x => x.key === 'createWithAI');
            });

            it('is the first action', () => {
                expect(local.getDashboardActions()[0].key).toEqual('createWithAI');
            });

            it('links to the create page with the assistant query', () => {
                expect(action.to).toEqual('/local/threatmodel/new?assistant=1');
            });

            it('uses the robot icon', () => {
                expect(action.icon).toEqual('robot');
            });
        });

        describe('import', () => {
            let action;

            beforeEach(() => {
                action = local.getDashboardActions().find(x => x.key === 'openExisting');
            });

            it('links to the import page', () => {
                expect(action.to).toEqual('/local/threatmodel/import');
            });

            it('uses the file-import icon', () => {
                expect(action.icon).toEqual('file-import');
            });
        });

        describe('new', () => {
            let action;

            beforeEach(() => {
                action = local.getDashboardActions().find(x => x.key === 'createNew');
            });

            it('links to the create page', () => {
                expect(action.to).toEqual('/local/threatmodel/new');
            });

            it('uses the plus icon', () => {
                expect(action.icon).toEqual('plus');
            });
        });

        describe('demo', () => {
            let action;

            beforeEach(() => {
                action = local.getDashboardActions().find(x => x.key === 'readDemo');
            });

            it('links to the demo select page', () => {
                expect(action.to).toEqual('/demo/select');
            });

            it('uses the cloud download icon', () => {
                expect(action.icon).toEqual('cloud-download-alt');
            });
        });
    });
});
