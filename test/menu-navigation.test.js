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

test('standalone pages link to Home and account pages retain one account-menu link', () => {
    const render = (view, locals = {}) =>
        pug.renderFile(path.join(__dirname, '../views', `${view}.pug`), {
            title: 'Example Page',
            ...locals,
        });
    for (const view of ['oembed', 'publish', 'account']) {
        const html = render(view);
        assert.equal(
            (
                html.match(
                    /href="\/"><span aria-hidden="true">🏠<\/span>Home<\/a>/g
                ) ?? []
            ).length,
            1,
            view
        );
        assert.match(html, /class="menu-link"/);
        assert.doesNotMatch(html, /href="\/account"/, view);
    }
    const home = render('index', { title: 'Home' });
    assert.match(home, /<title>Threads API Sample App - Home<\/title>/);
    assert.match(home, /<h1>Home<\/h1>/);
    assert.doesNotMatch(home, /class="menu-link"|Index/);
    const accountPages = [
        ['error', {}],
        ['debug', {}],
        ['threads', { threads: [], paging: {} }],
        ['upload', {}],
        ['profile_lookup', {}],
    ];
    for (const [view, locals] of accountPages) {
        const html = render(view, locals);
        assert.equal(
            (
                html.match(
                    /href="\/account"><span aria-hidden="true">👤<\/span>Account<\/a>/g
                ) ?? []
            ).length,
            1,
            view
        );
        assert.match(html, /class="menu-link account-link"/);
        assert.doesNotMatch(html, /href="\/"/, view);
    }
});
