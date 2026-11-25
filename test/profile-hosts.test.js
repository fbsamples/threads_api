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

test('profile lookup and embed examples link to current HTTPS profile URLs', () => {
    const expected = ['meta', 'threads', 'instagram', 'facebook'].map(
        (username) => `https://www.threads.com/@${username}`
    );
    for (const view of ['oembed', 'profile_lookup']) {
        const html = pug.renderFile(
            path.join(__dirname, '../views', `${view}.pug`),
            { title: 'Profile Examples', posts: [], paging: {} }
        );
        const links = Array.from(
            html.matchAll(/href="(https:\/\/www\.threads\.[^"]+)"/g),
            (match) => match[1]
        );
        assert.deepEqual(links, expected, view);
    }
});
