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

test('reply and quote targets appear above the form with matching links and unchanged submitted IDs', () => {
    const postID = '12345678901234567';
    const render = (values) =>
        pug.renderFile(path.join(__dirname, '../views/upload.pug'), {
            title: 'Upload',
            ...values,
        });
    for (const [field, label] of [
        ['replyToId', 'Replying to'],
        ['quotePostId', 'Quoting'],
    ]) {
        const html = render({ [field]: postID });
        const context = `${label} <a href="/threads/${postID}">post ${postID}</a>`;
        assert.ok(html.includes(context));
        const formTag = html.match(
            /<form\b[^>]*action="\/upload"[^>]*id="form"[^>]*method="POST"[^>]*>/
        );
        assert.ok(formTag);
        const formStart = formTag.index;
        assert.ok(html.indexOf(context) < formStart);
        const form = html.slice(formStart, html.indexOf('</form>', formStart));
        assert.ok(form.includes(`name="${field}" value="${postID}"`));
        assert.ok(form.includes('id="submit" value="Post"'));
        assert.ok(!form.includes(label));
        for (const value of [
            '0',
            'https://outside.example/',
            '<script>invalid</script>',
            ['123', '456'],
        ]) {
            const fallback = render({ [field]: value });
            assert.doesNotMatch(fallback, /<a href="\/threads\//);
            assert.doesNotMatch(fallback, /<script>invalid/);
        }
    }
    assert.doesNotMatch(render({}), /Replying to|Quoting|name="quotePostId"/);
    const both = render({ replyToId: postID, quotePostId: '456' });
    assert.match(both, /name="replyToId" value="12345678901234567"/);
    assert.match(both, /name="quotePostId" value="456"/);
});
