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
const ownPost = {
    id: '123',
    owner: { id: '456' },
    media_type: 'TEXT_POST',
    text: 'Test post',
};

async function startApp(t, api, authenticated = true, onApp) {
    const app = vm.runInNewContext(
        fs.readFileSync(entryPath, 'utf8') + '\napp;',
        {
            __dirname: path.dirname(entryPath),
            process: {
                env: {
                    SESSION_SECRET: 'test-session-secret',
                    ...(authenticated && {
                        INITIAL_ACCESS_TOKEN: 'test-access-token',
                        INITIAL_USER_ID: 'untrusted-initial-user',
                    }),
                },
            },
            console: { log() {}, error() {} },
            require(name) {
                if (name === 'axios') return api;
                if (name === 'dotenv') return { config() {} };
                if (name === 'fs') return { readFileSync: () => '' };
                if (name === 'https')
                    return { ...https, createServer: () => ({ listen() {} }) };
                return appRequire(name);
            },
        },
        { filename: entryPath }
    );
    onApp?.(app);
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    return async (route, options = {}) => {
        const response = await fetch(new URL(route, baseUrl), {
            ...options,
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
            headers: { ...(cookie && { cookie }), ...options.headers },
        });
        cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
        return response;
    };
}

function apiForPost(
    post = ownPost,
    remove = () => assert.fail('Unexpected deletion')
) {
    return {
        async get(url) {
            const apiUrl = new URL(url);
            if (apiUrl.pathname === '/me') return { data: { id: '456' } };
            if (apiUrl.pathname === '/123') return { data: post };
            return { data: { data: [ownPost] } };
        },
        delete: remove,
    };
}

async function csrfToken(request) {
    const html = await (await request('/threads')).text();
    const match = html.match(/name="csrfToken" value="([a-f0-9]{64})"/);
    assert.ok(match, 'A session-bound token is included in the form');
    return match[1];
}

function deleteRequest(request, token, extra = {}) {
    return request('/threads/123/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrfToken: token, ...extra }),
    });
}

test('only eligible rows in the own-post list show controls and cancellation prevents submission', async (t) => {
    const api = apiForPost();
    const get = api.get;
    api.get = async (url) =>
        new URL(url).pathname === '/me/threads'
            ? {
                  data: {
                      data: [
                          ownPost,
                          {
                              ...ownPost,
                              id: '124',
                              media_type: 'REPOST_FACADE',
                          },
                          { ...ownPost, id: '125', media_type: undefined },
                          { ...ownPost, id: '126', media_type: 'UNSUPPORTED' },
                      ],
                  },
              }
            : get(url);
    const request = await startApp(t, api);
    const html = await (await request('/threads')).text();
    assert.match(html, /aria-label="Delete Post" title="Delete Post"/);
    assert.match(html, /action="\/threads\/123\/delete" method="POST"/);
    assert.doesNotMatch(html, /action="\/threads\/(124|125|126)\/delete"/);
    const handler = html
        .match(/onsubmit="([^"]+)"/)[1]
        .replaceAll('&#39;', "'");
    let prompt;
    const submit = vm.runInNewContext(`(function () { ${handler} })()`, {
        confirm(message) {
            prompt = message;
            return false;
        },
    });
    assert.equal(submit, false);
    assert.match(prompt, /Are you sure\?.*cannot be undone/);
    assert.doesNotMatch(
        await (await request('/replies')).text(),
        /csrfToken|Delete Post/
    );
});

test('authentication, forged tokens, and cross-session tokens cannot trigger deletion', async (t) => {
    let calls = 0;
    const api = {
        get: async () => {
            calls++;
            return { data: { data: [ownPost] } };
        },
        delete: () => assert.fail('Unexpected deletion'),
    };
    const signedOut = await startApp(t, api, false);
    assert.equal((await deleteRequest(signedOut, 'forged')).status, 302);
    assert.equal(calls, 0);
    const request = await startApp(t, api);
    assert.equal((await deleteRequest(request, 'forged')).status, 403);
    assert.equal(calls, 0);
    const token = await csrfToken(request);
    const anotherSession = await startApp(t, api);
    await csrfToken(anotherSession);
    const callsBeforePost = calls;
    assert.equal((await deleteRequest(anotherSession, token)).status, 403);
    assert.equal(calls, callsBeforePost);
    const invalid = await request('/threads/%2F%2Fexample.com/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrfToken: token }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls, callsBeforePost);
});

test('ownership comes from the authenticated API identity, not submitted or initial user IDs', async (t) => {
    for (const post of [
        { ...ownPost, owner: { id: '999' } },
        { id: '123', media_type: 'TEXT_POST' },
        { ...ownPost, media_type: 'REPOST_FACADE' },
        { ...ownPost, media_type: undefined },
        { ...ownPost, media_type: 'UNSUPPORTED' },
    ]) {
        const request = await startApp(t, apiForPost(post));
        const token = await csrfToken(request);
        const response = await deleteRequest(request, token, {
            owner: '456',
            user_id: '456',
        });
        assert.equal(response.status, 403);
        assert.match(
            await response.text(),
            /Choose one of your posts|post type is not supported/
        );
    }
    let removed = false;
    const api = apiForPost(ownPost, async (url, options) => {
        assert.equal(new URL(url).pathname, '/123');
        assert.equal(
            new URL(url).searchParams.get('access_token'),
            'test-access-token'
        );
        assert.ok(options.httpsAgent);
        removed = true;
        return { data: { success: true, deleted_id: '123' } };
    });
    const get = api.get;
    api.get = async (url) =>
        new URL(url).pathname === '/me/threads' && removed
            ? { data: { data: [] } }
            : get(url);
    const request = await startApp(t, api);
    assert.equal(Object.hasOwn(ownPost, 'is_reply'), false);
    const response = await deleteRequest(request, await csrfToken(request), {
        owner: '999',
        user_id: '999',
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/threads');
    assert.equal(removed, true);
    assert.doesNotMatch(await (await request('/threads')).text(), /Test post/);
});

test('unconfirmed or failed API responses show an error and do not redirect', async (t) => {
    const responses = [
        () => ({ data: { success: false, deleted_id: '123' } }),
        () => ({ data: { success: true, deleted_id: '999' } }),
        () => {
            throw {
                response: {
                    data: {
                        error: { message: 'Delete permission is required.' },
                    },
                },
            };
        },
    ];
    for (const result of responses) {
        const request = await startApp(
            t,
            apiForPost(ownPost, async () => result())
        );
        const response = await deleteRequest(request, await csrfToken(request));
        assert.equal(response.status, 502);
        assert.equal(response.headers.get('location'), null);
        assert.match(
            await response.text(),
            /Deletion was not confirmed|Delete permission is required/
        );
    }
});

test('owned detail shows Delete after Quote and Repost and reuses the existing guarded POST', async (t) => {
    let deleted = 0;
    const api = apiForPost(ownPost, async () => {
        deleted++;
        return { data: { success: true, deleted_id: '123' } };
    });
    const get = api.get;
    const reads = [];
    api.get = async (url) => {
        reads.push(new URL(url));
        return get(url);
    };
    const request = await startApp(t, api);
    const html = await (await request('/threads/123')).text();
    const quotePosition = html.indexOf('<td>Quote</td>');
    const repostPosition = html.indexOf('<td>Repost</td>');
    const deletePosition = html.indexOf('<td>Delete</td>');
    assert.ok(
        quotePosition >= 0 &&
            repostPosition > quotePosition &&
            deletePosition > repostPosition
    );
    assert.match(html, /aria-label="Delete Post" title="Delete Post"/);
    const mainRead = reads.find((url) => url.pathname === '/123');
    assert.equal(
        mainRead.searchParams.get('fields').split(',').includes('owner'),
        false
    );
    assert.ok(
        reads.some(
            (url) =>
                url.pathname === '/123' &&
                url.searchParams.get('fields') === 'id,media_type,owner'
        )
    );
    const tokenMatch = html.match(/name="csrfToken" value="([a-f0-9]{64})"/);
    assert.ok(tokenMatch);
    const token = tokenMatch[1];
    const handler = html
        .match(/onsubmit="([^"]+)"/)[1]
        .replaceAll('&#39;', "'");
    assert.equal(
        vm.runInNewContext(`(function () { ${handler} })()`, {
            confirm: () => false,
        }),
        false
    );
    assert.equal(deleted, 0);
    assert.equal(await csrfToken(request), token);
    const secondDetail = await (await request('/threads/123')).text();
    assert.match(secondDetail, new RegExp(`name="csrfToken" value="${token}"`));
    const response = await deleteRequest(request, token);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/threads');
    assert.equal(deleted, 1);
});

test('detail hides Delete for foreign or unsupported posts and preserves the page when the owner probe fails', async (t) => {
    for (const post of [
        { ...ownPost, owner: { id: '999' } },
        { ...ownPost, owner: undefined },
        { ...ownPost, media_type: 'REPOST_FACADE' },
        { ...ownPost, media_type: 'UNSUPPORTED' },
    ]) {
        const request = await startApp(t, apiForPost(post));
        const html = await (
            await request('/threads/123?owner=456&user_id=456')
        ).text();
        assert.match(html, /Test post/);
        assert.doesNotMatch(html, /Delete Post|name="csrfToken"/);
    }
    const api = apiForPost();
    const get = api.get;
    api.get = async (url) => {
        if (new URL(url).searchParams.get('fields') === 'id,media_type,owner') {
            throw {
                response: {
                    status: 403,
                    data: { error: { message: 'Owner field is unavailable.' } },
                },
            };
        }
        return get(url);
    };
    const request = await startApp(t, api);
    const response = await request('/threads/123');
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Test post/);
    assert.match(html, /<td>Quote<\/td>/);
    assert.match(html, /<td>Repost<\/td>/);
    assert.doesNotMatch(html, /Delete Post|Owner field is unavailable/);
});

test('signed-out and nonnumeric detail requests do not call the API', async (t) => {
    const api = {
        get: () => assert.fail('Unexpected API read'),
        delete: () => assert.fail('Unexpected deletion'),
    };
    const signedOut = await startApp(t, api, false);
    assert.equal((await signedOut('/threads/123')).status, 302);
    const request = await startApp(t, api);
    assert.equal((await request('/threads/%2F%2Fexample.com')).status, 400);
});

test('delete limits block API work and keep independent client IP budgets', async (t) => {
    let app;
    let reads = 0;
    let deletes = 0;
    const api = apiForPost(ownPost, async () => {
        deletes++;
        return { data: { success: true, deleted_id: ownPost.id } };
    });
    const get = api.get;
    api.get = async (url) => {
        reads++;
        return get(url);
    };
    const request = await startApp(t, api, true, (instance) => {
        app = instance;
    });
    const token = await csrfToken(request);
    for (let i = 0; i < 10; i++) {
        const response = await deleteRequest(request, token);
        assert.equal(response.status, 303);
        await response.text();
    }
    const readCount = reads;
    const blocked = await deleteRequest(request, token);
    assert.equal(blocked.status, 429);
    const retryAfter = Number(blocked.headers.get('retry-after'));
    assert.ok(retryAfter > 0 && retryAfter <= 60);
    assert.match(
        await blocked.text(),
        /Too many delete requests\. Wait a minute and try again\./
    );
    assert.equal(reads, readCount);
    assert.equal(deletes, 10);

    async function signedOutClient(host) {
        const server = http.createServer(app);
        server.listen(0, host);
        await once(server, 'listening');
        t.after(() => new Promise((resolve) => server.close(resolve)));
        const address = host.includes(':') ? `[${host}]` : host;
        return () =>
            fetch(
                `http://${address}:${server.address().port}/threads/123/delete`,
                {
                    method: 'POST',
                    redirect: 'manual',
                    signal: AbortSignal.timeout(10000),
                }
            );
    }
    const sameIp = await signedOutClient('127.0.0.1');
    const sameIpResponse = await sameIp();
    assert.equal(sameIpResponse.status, 429);
    await sameIpResponse.text();
    const otherIp = await signedOutClient('::1');
    for (let i = 0; i < 10; i++) {
        const response = await otherIp();
        assert.equal(response.status, 302);
        await response.text();
    }
    const otherIpBlocked = await otherIp();
    assert.equal(otherIpBlocked.status, 429);
    assert.ok(Number(otherIpBlocked.headers.get('retry-after')) > 0);
    await otherIpBlocked.text();
    assert.equal(reads, readCount);
    assert.equal(deletes, 10);
});
