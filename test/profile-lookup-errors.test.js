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
const lookupError =
    'This profile is unavailable or cannot be accessed. Try another username or check your access.';
const postsError =
    'The profile loaded, but its posts could not be retrieved. Try again.';
const profile = {
    name: 'Example Profile',
    biography: 'Example biography.',
    profile_picture_url: 'https://example.com/profile.png',
    follower_count: 1234,
};
const post = {
    id: '123',
    text: 'Example post.',
    media_type: 'TEXT_POST',
    timestamp: '2026-11-24T10:00:00Z',
    permalink: 'https://example.com/post',
};

async function startApp(t, get) {
    const calls = [];
    const logs = [];
    const app = vm.runInNewContext(
        fs.readFileSync(entryPath, 'utf8') + '\napp;',
        {
            __dirname: path.dirname(entryPath),
            process: {
                env: {
                    SESSION_SECRET: 'test-session-secret',
                    INITIAL_ACCESS_TOKEN: 'test-access-token',
                    INITIAL_USER_ID: '456',
                },
            },
            console: {
                log() {},
                error: (...args) => logs.push(args.join(' ')),
            },
            require(name) {
                if (name === 'axios')
                    return {
                        get: async (url, config) => {
                            const api = new URL(url);
                            calls.push(api);
                            return get(api, config);
                        },
                        post: () => assert.fail('Unexpected API write.'),
                        delete: () => assert.fail('Unexpected API write.'),
                    };
                if (name === 'dotenv') return { config() {} };
                if (name === 'fs') return { readFileSync: () => '' };
                if (name === 'https')
                    return {
                        ...https,
                        createServer: () => ({ listen() {} }),
                    };
                return appRequire(name);
            },
        },
        { filename: entryPath, timeout: 3000 }
    );
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    async function request(route) {
        const url = new URL(route, base);
        assert.equal(url.origin, base, 'Requests stay on loopback.');
        const response = await fetch(url, {
            redirect: 'manual',
            signal: AbortSignal.timeout(5000),
            headers: cookie ? { cookie } : {},
        });
        cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
        return response;
    }
    await request('/');
    return { request, calls, logs };
}

function assertNoResults(html) {
    assert.doesNotMatch(html, /class="profile-picture"|<table|class="paging"/);
}

function assertSafeError(html, logs, error) {
    assert.ok(html.includes(error));
    assert.deepEqual(logs, [error]);
    assert.doesNotMatch(
        html + logs.join(' '),
        /restricted-detail|raw-secret|graph\.threads\.com|test-access-token/
    );
}

test('blank and obviously malformed usernames make no API call and hide results', async (t) => {
    const { request, calls, logs } = await startApp(t, () =>
        assert.fail('Unexpected API lookup.')
    );
    for (const query of ['', 'username=', 'username=%20%20']) {
        const initial = await request(`/profileLookup?${query}`);
        assert.equal(initial.status, 200);
        assertNoResults(await initial.text());
    }
    for (const query of [
        'username=two%20words',
        'username=%40',
        'username=%40%40example',
        'username=https%3A%2F%2Fexample.com%2Fprofile',
        'username=%3Cscript%3E',
        'username=%3CSCRIPT%3E',
        'username=%3CsCrIpT%3E',
        'username[]=example',
    ]) {
        const response = await request(`/profileLookup?${query}`);
        assert.equal(response.status, 400);
        const html = await response.text();
        assert.match(html, /Enter a username or a Threads profile URL\./);
        assertNoResults(html);
        if (/^username=%3Cscript%3E$/i.test(query)) {
            assert.match(html, /name="username" value="&lt;script&gt;"/i);
            assert.doesNotMatch(html, /<script>/i);
        }
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(logs, []);
});

test('usernames, handles, and profile URLs send only the extracted username and retain entered input', async (t) => {
    const { request, calls } = await startApp(t, (api, config) => {
        assert.equal(api.origin, 'https://graph.threads.com');
        assert.ok(config.httpsAgent);
        assert.equal(api.searchParams.get('username'), 'example.profile');
        return api.pathname === '/profile_lookup'
            ? { data: profile }
            : {
                  data: {
                      data: [],
                      paging: {
                          next: 'https://graph.threads.com/profile_posts?username=example.profile&after=next&access_token=raw-secret',
                      },
                  },
              };
    });
    for (const input of [
        'example.profile',
        '@example.profile',
        '  @example.profile  ',
        'https://www.threads.com/@example.profile',
        'https://threads.com/@example.profile/?source=share#profile',
        'https://www.threads.net/@example.profile',
        'http://threads.net/@example.profile',
        'HTTPS://WWW.THREADS.COM/@%65xample.profile',
    ]) {
        calls.length = 0;
        const response = await request(
            `/profileLookup?${new URLSearchParams({ username: input })}`
        );
        assert.equal(response.status, 200);
        const html = await response.text();
        const escapedInput = input.replaceAll('&', '&amp;');
        assert.ok(html.includes(`name="username" value="${escapedInput}"`));
        assert.match(html, /<td colspan="2">example\.profile<\/td>/);
        assert.deepEqual(
            calls.map((api) => api.pathname),
            ['/profile_lookup', '/profile_posts']
        );
        const next = new URL(
            html.match(/href="([^"]+)">Next<\/a>/)[1].replaceAll('&amp;', '&')
        );
        assert.equal(next.searchParams.get('username'), 'example.profile');
        assert.equal(next.searchParams.get('after'), 'next');
        assert.equal(next.searchParams.has('access_token'), false);
        await request(next);
        assert.equal(calls.length, 4);
    }
    for (const input of [
        'https://www.threads.com/@example.profile/post/123',
        'https://www.threads.com/@example.profile/../@other',
        'https://www.threads.com.evil.example/@example.profile',
        'https://evil.example/@example.profile',
        'https://user:password@threads.com/@example.profile',
        'https://threads.com:8443/@example.profile',
        'https://threads.com:443/@example.profile',
        'http://threads.com:80/@example.profile',
        'https://@threads.com/@example.profile',
        'https://%74hreads.com/@example.profile',
        'https://threads.com/@example%2Fprofile',
        'https://threads.com/@example%ZZ',
        'https://threads.com\\@example.profile',
        'javascript:example.profile',
    ]) {
        calls.length = 0;
        const response = await request(
            `/profileLookup?${new URLSearchParams({ username: input })}`
        );
        assert.equal(response.status, 400);
        const html = await response.text();
        assert.match(html, /Enter a username or a Threads profile URL\./);
        assertNoResults(html);
        assert.equal(calls.length, 0);
    }
});

test('restricted and transport lookup failures show a fixed message without requesting posts', async (t) => {
    let restricted = true;
    const { request, calls, logs } = await startApp(t, (api) => {
        assert.equal(api.pathname, '/profile_lookup');
        if (restricted) {
            throw {
                response: {
                    status: 403,
                    data: {
                        error: { message: 'restricted-detail raw-secret' },
                    },
                },
            };
        }
        throw new Error('https://graph.threads.com/?access_token=raw-secret');
    });
    for (const isRestricted of [true, false]) {
        restricted = isRestricted;
        logs.length = 0;
        const response = await request(
            '/profileLookup?username=example.profile'
        );
        assert.equal(response.status, 502);
        const html = await response.text();
        assertSafeError(html, logs, lookupError);
        assert.match(html, /name="username" value="example.profile"/);
        assertNoResults(html);
    }
    assert.deepEqual(
        calls.map((api) => api.pathname),
        ['/profile_lookup', '/profile_lookup']
    );
    logs.length = 0;
    const restrictedInput = '  https://www.threads.com/@example.profile  ';
    calls.length = 0;
    const restrictedResponse = await request(
        `/profileLookup?${new URLSearchParams({ username: restrictedInput })}`
    );
    assert.equal(restrictedResponse.status, 502);
    const restrictedHTML = await restrictedResponse.text();
    assertSafeError(restrictedHTML, logs, lookupError);
    assert.ok(
        restrictedHTML.includes(`name="username" value="${restrictedInput}"`)
    );
    assertNoResults(restrictedHTML);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get('username'), 'example.profile');
});

test('fulfilled primary lookups reject unusable data but accept optional fields and zero counts', async (t) => {
    let primary;
    const { request, calls, logs } = await startApp(t, (api) => {
        if (api.pathname === '/profile_lookup') return { data: primary };
        assert.equal(api.pathname, '/profile_posts');
        return { data: { data: [] } };
    });
    for (const data of [
        {
            name: 'Example Profile',
            error: { message: 'restricted-detail raw-secret' },
        },
        {},
        { name: '', follower_count: null },
    ]) {
        primary = data;
        calls.length = 0;
        logs.length = 0;
        const response = await request(
            '/profileLookup?username=example.profile'
        );
        assert.equal(response.status, 502);
        const html = await response.text();
        assertSafeError(html, logs, lookupError);
        assertNoResults(html);
        assert.equal(calls.length, 1);
    }
    for (const data of [{ name: 'Example Profile' }, { follower_count: 0 }]) {
        primary = data;
        calls.length = 0;
        logs.length = 0;
        const response = await request(
            '/profileLookup?username=example.profile'
        );
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /class="profile-picture"/);
        assert.deepEqual(
            calls.map((api) => api.pathname),
            ['/profile_lookup', '/profile_posts']
        );
        assert.deepEqual(logs, []);
    }
});

test('successful profile and post lookups preserve request fields, dates, and paging', async (t) => {
    const { request, calls, logs } = await startApp(t, (api, config) => {
        assert.ok(config.httpsAgent);
        if (api.pathname === '/profile_lookup') return { data: profile };
        assert.equal(api.pathname, '/profile_posts');
        return {
            data: {
                data: [post],
                paging: {
                    next: 'https://graph.threads.com/profile_posts?username=example.profile&limit=2&after=next%2B&access_token=raw-secret',
                    previous:
                        'https://graph.threads.com/profile_posts?username=example.profile&limit=2&before=back%2B&access_token=raw-secret',
                },
            },
        };
    });
    const response = await request(
        '/profileLookup?username=example.profile&before=old&limit=2'
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /name="username" value="example.profile"/);
    assert.match(html, /class="profile-picture"/);
    assert.match(html, /Example Profile|Example biography\./);
    assert.match(html, /<td colspan="2">1,234<\/td>/);
    assert.match(html, /Example post\./);
    assert.match(
        html,
        /datetime="2026-11-24T10:00:00.000Z" data-local-timestamp=""/
    );
    assert.doesNotMatch(html, /alert-error|raw-secret|test-access-token/);
    assert.equal(calls[0].searchParams.get('username'), 'example.profile');
    assert.equal(
        calls[1].searchParams.get('fields'),
        'text,media_type,media_url,permalink,timestamp'
    );
    assert.equal(calls[1].searchParams.get('limit'), '2');
    assert.equal(calls[1].searchParams.get('before'), 'old');
    const next = new URL(
        html.match(/href="([^"]+)">Next<\/a>/)[1].replaceAll('&amp;', '&')
    );
    assert.equal(next.searchParams.get('username'), 'example.profile');
    assert.equal(next.searchParams.get('after'), 'next+');
    assert.equal(next.searchParams.has('before'), false);
    await request(next);
    assert.equal(calls[3].searchParams.get('after'), 'next+');
    assert.equal(calls[3].searchParams.has('before'), false);
    assert.deepEqual(logs, []);
});

test('posts-only failures keep the loaded profile and clear rows and paging', async (t) => {
    let failure;
    const { request, logs } = await startApp(t, (api) => {
        if (api.pathname === '/profile_lookup') return { data: profile };
        if (failure === 'request') throw new Error('raw-secret');
        if (failure === 'payload')
            return { data: { error: { message: 'raw-secret' } } };
        if (failure === 'error_array')
            return { data: { data: [post], error: { message: 'raw-secret' } } };
        if (failure === 'null_member') return { data: { data: [post, null] } };
        if (failure === 'empty') return { data: { data: [] } };
        if (failure && typeof failure === 'object')
            return { data: { data: [post, failure] } };
        return {
            data: {
                data: [post],
                paging: {
                    next: 'https://graph.threads.com/profile_posts?after=next&username=example.profile',
                    ...(failure === 'paging' && { previous: 'http://[' }),
                },
            },
        };
    });
    const successful = await request('/profileLookup?username=example.profile');
    assert.match(await successful.text(), /Example post\./);
    for (const boundary of [
        'request',
        'payload',
        'error_array',
        'null_member',
        'paging',
        {},
        { text: 'Example row without an ID.' },
        { id: 'not-decimal' },
        { id: 123 },
        { id: '0' },
        { id: '123\n' },
    ]) {
        failure = boundary;
        logs.length = 0;
        const response = await request(
            '/profileLookup?username=example.profile&after=next'
        );
        assert.equal(response.status, 502);
        const html = await response.text();
        assertSafeError(html, logs, postsError);
        assert.match(html, /Example Profile/);
        assert.match(html, /class="profile-picture"/);
        assert.match(html, /name="username" value="example.profile"/);
        assert.doesNotMatch(
            html,
            /Example post\.|class="threads-list"|class="paging"|>Next<|>Previous</
        );
    }
    failure = 'empty';
    logs.length = 0;
    const emptyResponse = await request(
        '/profileLookup?username=example.profile'
    );
    assert.equal(emptyResponse.status, 200);
    const emptyHtml = await emptyResponse.text();
    assert.match(emptyHtml, /Example Profile/);
    assert.match(emptyHtml, /class="threads-list"/);
    assert.doesNotMatch(
        emptyHtml,
        /Example post\.|>Next<|>Previous<|alert-error/
    );
    assert.deepEqual(logs, []);
});
