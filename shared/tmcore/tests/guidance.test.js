import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MODELING_GUIDANCE, buildModelTask, reviewCoverageTask } from '../guidance.js';

test('MODELING_GUIDANCE teaches readable layout and thorough STRIDE', () => {
    assert.ok(MODELING_GUIDANCE.length > 400);
    for (const kw of ['Readable layout', 'STRIDE', 'trust boundary', 'mitigation', 'Spoofing', 'left-to-right', 'Never leave a flow named']) {
        assert.ok(MODELING_GUIDANCE.includes(kw), `guidance should mention "${kw}"`);
    }
});

test('buildModelTask embeds the guidance and the system description', () => {
    const t = buildModelTask('My SaaS document app');
    assert.ok(t.includes(MODELING_GUIDANCE));
    assert.ok(t.includes('My SaaS document app'));
});

test('buildModelTask tolerates a missing description', () => {
    assert.ok(buildModelTask().includes(MODELING_GUIDANCE));
});

test('reviewCoverageTask embeds the guidance and a review instruction', () => {
    const t = reviewCoverageTask();
    assert.ok(t.includes(MODELING_GUIDANCE));
    assert.match(t, /review|gaps|coverage/i);
});
