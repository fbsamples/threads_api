/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { test } = require('node:test');

const entryPath = path.join(__dirname, '../src/index.js');
const appRequire = createRequire(entryPath);

async function startApp(t, get, authenticated = true) {
    const app = vm.runInNewContext(
        fs.readFileSync(entryPath, 'utf8') + '\napp;',
        {
            __dirname: path.dirname(entryPath),
            process: {
                env: {
                    SESSION_SECRET: 'test-session-secret',
                    ...(authenticated && {
                        INITIAL_ACCESS_TOKEN: 'test-access-token',
                        INITIAL_USER_ID: 'test-user',
                    }),
                },
            },
            console: { log() {}, error() {} },
            require(name) {
                if (name === 'axios') return { get };
                if (name === 'dotenv') return { config() {} };
                if (name === 'fs') return { readFileSync: () => '' };
                if (name === 'https') {
                    return {
                        ...https,
                        createServer: () => ({ listen() {} }),
                    };
                }
                return appRequire(name);
            },
        },
        { filename: entryPath }
    );
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    return async (url) => {
        const response = await fetch(new URL(url, baseUrl), {
            redirect: 'manual',
            headers: cookie ? { cookie } : {},
        });
        cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
        return response;
    };
}

function pagingLink(html, label) {
    const match = html.match(new RegExp(`<a href="([^"]+)">${label}</a>`));
    assert.ok(match, `${label} link is present`);
    return new URL(match[1].replaceAll('&amp;', '&'));
}

test('search pagination keeps the query, replaces cursors, and excludes tokens', async (t) => {
    const calls = [];
    const request = await startApp(t, async (url) => {
        const apiUrl = new URL(url);
        calls.push(apiUrl);
        const paging = apiUrl.searchParams.has('after')
            ? {
                  previous:
                      'https://graph.threads.com/keyword_search?limit=5&before=back%2B%2F%3D&access_token=private-api-token',
              }
            : {
                  next: 'https://graph.threads.com/keyword_search?limit=5&after=next%2B%2F%3D&access_token=private-api-token',
                  previous:
                      'https://graph.threads.com/keyword_search?limit=5&before=back%2B%2F%3D&access_token=private-api-token',
              };
        return { data: { data: [], paging } };
    });
    const query = 'café & music + #1';
    const response = await request(
        `/keywordSearch?${new URLSearchParams({
            keyword: query,
            searchType: 'RECENT',
            before: 'old-cursor',
            limit: '5',
            access_token: 'untrusted-request-token',
        })}`
    );
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<option value="RECENT" selected/);
    const next = pagingLink(html, 'Next');
    const previousPosition = html.indexOf('>Previous</a>');
    assert.ok(
        previousPosition >= 0 && previousPosition < html.indexOf('>Next</a>')
    );
    assert.equal(next.pathname, '/keywordSearch');
    assert.equal(next.searchParams.get('keyword'), query);
    assert.equal(next.searchParams.get('searchType'), 'RECENT');
    assert.equal(next.searchParams.get('after'), 'next+/=');
    assert.equal(next.searchParams.has('before'), false);
    assert.equal(next.searchParams.has('access_token'), false);
    assert.doesNotMatch(html, /private-api-token|untrusted-request-token/);

    const nextHtml = await (await request(next)).text();
    assert.equal(calls[1].searchParams.get('q'), query);
    assert.equal(calls[1].searchParams.get('search_type'), 'RECENT');
    assert.equal(calls[1].searchParams.get('after'), 'next+/=');
    assert.equal(calls[1].searchParams.get('limit'), '5');
    assert.equal(calls[1].searchParams.has('before'), false);
    const previous = pagingLink(nextHtml, 'Previous');
    assert.equal(previous.searchParams.get('before'), 'back+/=');
    assert.equal(previous.searchParams.has('after'), false);
    await request(previous);
    assert.equal(calls[2].searchParams.get('before'), 'back+/=');
    assert.equal(calls[2].searchParams.get('q'), query);
});

test('search errors are visible and preserve the form without paging links', async (t) => {
    const request = await startApp(t, async () => {
        throw {
            response: {
                data: { error: { message: 'Search permission is required.' } },
            },
        };
    });
    const html = await (
        await request(
            '/keywordSearch?keyword=music&searchType=RECENT&after=expired'
        )
    ).text();
    assert.match(html, /Search permission is required\./);
    assert.match(html, /<textarea[^>]*>music<\/textarea>/);
    assert.match(html, /<option value="RECENT" selected/);
    assert.doesNotMatch(html, />Next<|>Previous</);
});

test('blank searches and signed-out requests do not call the API', async (t) => {
    const get = () => assert.fail('Unexpected API request');
    const request = await startApp(t, get);
    assert.equal((await request('/keywordSearch')).status, 200);
    const signedOutRequest = await startApp(t, get, false);
    const response = await signedOutRequest(
        '/keywordSearch?keyword=music&after=cursor'
    );
    assert.equal(response.status, 302);
    assert.equal(
        response.headers.get('location'),
        '/?return_url=%2FkeywordSearch%3Fkeyword%3Dmusic%26after%3Dcursor'
    );
});

test('the paging helper still preserves profile usernames and strips stale cursors', async (t) => {
    const request = await startApp(t, async (url) => {
        if (new URL(url).pathname === '/profile_lookup')
            return { data: { name: 'Test Profile' } };
        return {
            data: {
                data: [],
                paging: {
                    next: 'https://graph.threads.com/profile_posts?username=test-profile&limit=10&after=next-cursor&access_token=private-api-token',
                },
            },
        };
    });
    const html = await (
        await request('/profileLookup?username=test-profile&before=old-cursor')
    ).text();
    const next = pagingLink(html, 'Next');
    assert.equal(next.searchParams.get('username'), 'test-profile');
    assert.equal(next.searchParams.get('after'), 'next-cursor');
    assert.equal(next.searchParams.has('before'), false);
    assert.equal(next.searchParams.has('access_token'), false);
});
