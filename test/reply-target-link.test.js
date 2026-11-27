/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const pug = require('pug');

test('reply context links to the exact post and preserves safe fallbacks and submitted IDs', () => {
    const render = (replyToId) =>
        pug.renderFile(path.join(__dirname, '../views/upload.pug'), {
            title: 'Upload',
            replyToId,
        });
    const id = '12345678901234567';
    const html = render(id);
    assert.ok(
        html.includes(`Replying to <a href="/threads/${id}">post ${id}</a>`)
    );
    assert.ok(html.includes(`name="replyToId" value="${id}"`));
    for (const value of [
        '0',
        'https://outside.example/',
        '<script>invalid</script>',
        ['123', '456'],
    ]) {
        const fallback = render(value);
        assert.doesNotMatch(fallback, /<a href="\/threads\//);
        assert.doesNotMatch(fallback, /<script>invalid/);
    }
    assert.match(
        render('<script>invalid</script>'),
        /&lt;script&gt;invalid&lt;\/script&gt;/
    );
    assert.doesNotMatch(render(undefined), /Replying to/);
});
