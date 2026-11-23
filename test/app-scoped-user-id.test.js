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
const entry = path.join(__dirname, '../src/index.js');
const appRequire = createRequire(entry);
const userId = '17841405793187219';

async function startApp(t, api, initialId) {
    const logs = [];
    const app = vm.runInNewContext(fs.readFileSync(entry, 'utf8') + '\napp;', {
        __dirname: path.dirname(entry),
        process: {
            env: {
                SESSION_SECRET: 'synthetic-secret',
                ...(initialId !== undefined
                    ? {
                          INITIAL_ACCESS_TOKEN: 'synthetic-token',
                          INITIAL_USER_ID: initialId,
                      }
                    : {}),
            },
        },
        console: Object.fromEntries(
            ['log', 'error', 'warn'].map((level) => [
                level,
                (...values) =>
                    logs.push(
                        ...values.map((value) =>
                            typeof value === 'string'
                                ? value
                                : JSON.stringify(value)
                        )
                    ),
            ])
        ),
        require(name) {
            if (name === 'axios') return api;
            if (name === 'dotenv') return { config() {} };
            if (name === 'fs') return { readFileSync: () => '' };
            if (name === 'https')
                return { ...https, createServer: () => ({ listen() {} }) };
            return appRequire(name);
        },
    });
    app.post('/_test/session', (req, res) => {
        Object.assign(req.session, req.body);
        res.sendStatus(204);
    });
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1');
    await once(s, 'listening');
    t.after(() => new Promise((resolve) => s.close(resolve)));
    const base = `http://127.0.0.1:${s.address().port}`;
    let cookie;
    let requestCsrfToken;
    const request = async (route, body) => {
        if (body !== undefined && !requestCsrfToken) {
            const home = await request('/');
            const page = home.status === 302 ? await request('/oEmbed') : home;
            requestCsrfToken = (await page.text()).match(
                /name="csrf-token" content="([a-f0-9]{64})"/
            )[1];
        }
        const json = route === '/_test/session';
        const response = await fetch(new URL(route, base), {
            method: body === undefined ? 'GET' : 'POST',
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
            headers: {
                ...(cookie ? { cookie } : {}),
                ...(body === undefined
                    ? {}
                    : {
                          'X-CSRF-Token': requestCsrfToken,
                          'Content-Type': json
                              ? 'application/json'
                              : 'application/x-www-form-urlencoded',
                      }),
            },
            ...(body === undefined
                ? {}
                : { body: json ? JSON.stringify(body) : body.toString() }),
        });
        cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
        return response;
    };
    request.logs = logs;
    return request;
}
const form = (values) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) {
        if (Array.isArray(v)) for (const part of v) body.append(k + '[]', part);
        else body.set(k, v);
    }
    return body;
};
async function completeLogin(request) {
    const login = await request('/login');
    assert.equal(login.status, 302);
    const state = new URL(login.headers.get('location')).searchParams.get(
        'state'
    );
    return request(
        `/callback?${new URLSearchParams({ code: 'synthetic-code', state })}`
    );
}

function transform(raw, options) {
    return options.transformResponse.reduce((data, fn) => fn(data), raw);
}

test('OAuth keeps the exact app-scoped ID through token exchange and rejects ambiguous or missing identities', async (t) => {
    for (const failExtension of [false, true, 'malformed']) {
        const calls = [];
        const request = await startApp(t, {
            post: async (url, _body, options) => {
                assert.equal(new URL(url).pathname, '/oauth/access_token');
                return {
                    data: transform(
                        `{"access_token":"synthetic-short-token","user_id":${userId},"data":{"user_id":"999"},"note":"\\\"user_id\\\":123"}`,
                        options
                    ),
                };
            },
            get: async (url, options) => {
                const u = new URL(url);
                calls.push(u);
                if (u.pathname === '/debug_token') {
                    return {
                        data: transform(
                            `{"data":{"user_id":${userId},"scopes":["threads_basic"],"expires_at":1800000000,"issued_at":1700000000}}`,
                            options
                        ),
                    };
                }
                if (u.pathname === '/access_token') {
                    if (failExtension === true)
                        throw new Error('Synthetic exchange failure.');
                    if (failExtension === 'malformed')
                        return { data: { access_token: {} } };
                    return { data: { access_token: 'synthetic-long-token' } };
                }
                assert.equal(u.pathname, `/${userId}`);
                assert.equal(
                    u.searchParams.get('access_token'),
                    failExtension
                        ? 'synthetic-short-token'
                        : 'synthetic-long-token'
                );
                return { data: { id: '999', username: 'example' } };
            },
        });
        assert.equal((await completeLogin(request)).status, 302);
        await (await request('/account')).text();
        await (await request('/account?user_id=999')).text();
        const debug = await request('/debug');
        assert.equal(debug.status, 200);
        assert.match(await debug.text(), new RegExp('>' + userId + '<'));
        assert.equal(
            calls.filter((u) => u.pathname === `/${userId}`).length,
            2
        );
        assert.ok(calls.every((u) => !/^\/me(?:\/|$)/.test(u.pathname)));
    }
    const badDebug = await startApp(
        t,
        {
            get: async (_url, options) => ({
                data: transform(
                    '{"data":{"user_id":"456","scopes":null}}',
                    options
                ),
            }),
        },
        '456'
    );
    const badDebugResponse = await badDebug('/debug');
    assert.equal(badDebugResponse.status, 502);
    assert.match(
        await badDebugResponse.text(),
        /Unable to inspect the access token/
    );
    for (const raw of [
        '{"access_token":"synthetic-token","data":{"user_id":"456"}}',
        '{"access_token":"synthetic-token","user_id":"456","user_id":"789"}',
        '{"access_token":"synthetic-token","user_id":1e17}',
        '{"access_token":"synthetic-token","user_id":{"id":"456"}}',
    ]) {
        let gets = 0;
        const request = await startApp(t, {
            post: async (_url, _body, options) => ({
                data: transform(raw, options),
            }),
            get: async () => {
                gets++;
                assert.fail(
                    'Invalid sign-in must not reach an authenticated API.'
                );
            },
        });
        const callback = await completeLogin(request);
        assert.equal(callback.status, 502);
        await callback.text();
        assert.equal((await request('/account')).status, 302);
        assert.equal(gets, 0);
    }
});

test('reads, paging, carousel creation, and publishing use only the session ID', async (t) => {
    const calls = [];
    const request = await startApp(
        t,
        {
            get: async (url) => {
                const u = new URL(url);
                calls.push(u);
                assert.ok(u.pathname.startsWith(`/${userId}`));
                if (u.pathname.endsWith('/threads_insights'))
                    return { data: { data: [] } };
                if (u.pathname.endsWith('/threads_publishing_limit'))
                    return {
                        data: {
                            data: [
                                {
                                    config: {},
                                    reply_config: {},
                                    delete_config: {},
                                    location_search_config: {},
                                },
                            ],
                        },
                    };
                if (u.pathname === `/${userId}`)
                    return { data: { username: 'example' } };
                return {
                    data: {
                        data: [],
                        paging: {
                            next: `https://graph.threads.com/me/threads?after=next&limit=2&access_token=synthetic-paging-token`,
                        },
                    },
                };
            },
            post: async (url) => {
                const u = new URL(url);
                calls.push(u);
                assert.ok(
                    [
                        `/${userId}/threads`,
                        `/${userId}/threads_publish`,
                    ].includes(u.pathname)
                );
                return { data: { id: '123' } };
            },
        },
        userId
    );
    for (const route of [
        '/account',
        '/userInsights',
        '/publishingLimit',
        '/replies',
        '/mentions',
    ])
        assert.equal((await request(`${route}?user_id=999`)).status, 200);
    const html = await (await request('/threads?user_id=999')).text();
    const href = html
        .match(/<a href="([^"]+)">Next<\/a>/)[1]
        .replaceAll('&amp;', '&');
    assert.ok(!href.includes('access_token'));
    await (await request(href)).text();
    assert.equal(calls.at(-1).pathname, `/${userId}/threads`);
    assert.equal(calls.at(-1).searchParams.get('after'), 'next');
    await (
        await request(
            '/upload',
            form({
                text: 'Example',
                topicTag: '',
                attachmentType: ['Image', 'Video'],
                attachmentUrl: [
                    'https://example.invalid/a.jpg',
                    'https://example.invalid/b.mp4',
                ],
                attachmentAltText: ['A', 'B'],
                user_id: '999',
            })
        )
    ).text();
    await (
        await request('/publish', form({ containerId: '123', user_id: '999' }))
    ).text();
    assert.equal(
        calls.filter((u) => u.pathname === `/${userId}/threads`).length,
        5
    );
    assert.equal(calls.at(-1).pathname, `/${userId}/threads_publish`);
    assert.ok(calls.every((u) => !/^\/me(?:\/|$)/.test(u.pathname)));
    for (const invalidId of [
        undefined,
        '',
        'me',
        '0',
        '456/threads',
        {},
        456,
    ]) {
        let apiCalls = 0;
        const invalid = await startApp(t, {
            get: () => {
                apiCalls++;
            },
            post: () => {
                apiCalls++;
            },
        });
        await invalid('/_test/session', {
            access_token: 'synthetic-token',
            user_id: invalidId,
        });
        assert.equal((await invalid('/account?user_id=456')).status, 401);
        assert.equal((await invalid('/upload', form({}))).status, 401);
        assert.equal(
            (await invalid('/publish', form({ containerId: '123' }))).status,
            401
        );
        assert.equal(apiCalls, 0);
    }
});

test('configured IDs cannot authorize deletion without a token binding and cached bindings follow the token-ID pair', async (t) => {
    for (const debugResponse of [
        null,
        { is_valid: true },
        { is_valid: true, user_id: '789' },
        { is_valid: true, user_id: { id: '456' } },
        { is_valid: false, user_id: '456' },
    ]) {
        let deleted = 0;
        const request = await startApp(
            t,
            {
                get: async (url, _options) => {
                    const u = new URL(url);
                    if (u.pathname === '/debug_token')
                        return {
                            data: { data: debugResponse, user_id: '456' },
                        };
                    if (u.pathname === '/456') return { data: { id: '456' } };
                    if (u.pathname === '/123')
                        return {
                            data: {
                                id: '123',
                                owner: { id: '456' },
                                media_type: 'TEXT_POST',
                            },
                        };
                    return {
                        data: {
                            data: [{ id: '123', media_type: 'TEXT_POST' }],
                        },
                    };
                },
                delete: async () => {
                    deleted++;
                },
            },
            '456'
        );
        const list = await (await request('/threads')).text();
        const csrf = list.match(/name="csrfToken" value="([a-f0-9]+)"/)[1];
        const result = await request(
            '/threads/123/delete',
            form({ csrfToken: csrf, owner: '456', user_id: '456' })
        );
        assert.equal(result.status, 403);
        assert.equal(deleted, 0);
    }
    let debugCalls = 0;
    let deleted = 0;
    const request = await startApp(
        t,
        {
            get: async (url, options) => {
                const u = new URL(url);
                if (u.pathname === '/debug_token') {
                    debugCalls++;
                    if (
                        u.searchParams.get('access_token') ===
                        'synthetic-replaced-token'
                    )
                        throw {
                            message: 'synthetic-private-token-message',
                            response: {
                                data: {
                                    error: {
                                        message:
                                            'synthetic-private-token-message',
                                    },
                                },
                            },
                        };
                    return {
                        data: transform(
                            `{"user_id":"789","data":{"is_valid":true,"user_id":${userId}}}`,
                            options
                        ),
                    };
                }
                if (u.pathname === `/${userId}`)
                    return { data: { id: userId } };
                if (u.pathname === '/123')
                    return {
                        data: {
                            id: '123',
                            owner: { id: userId },
                            media_type: 'TEXT_POST',
                        },
                    };
                return { data: { data: [] } };
            },
            delete: async () => {
                deleted++;
                return { data: { success: true, deleted_id: '123' } };
            },
        },
        userId
    );
    const html = await (await request('/threads/123')).text();
    const csrf = html.match(/name="csrfToken" value="([a-f0-9]+)"/)[1];
    assert.equal(debugCalls, 1);
    await request('/_test/session', { user_id: '789' });
    assert.equal(
        (await request('/threads/123/delete', form({ csrfToken: csrf })))
            .status,
        403
    );
    assert.equal(deleted, 0);
    assert.equal(debugCalls, 2);
    await request('/_test/session', {
        user_id: userId,
        access_token: 'synthetic-replaced-token',
    });
    assert.equal(
        (await request('/threads/123/delete', form({ csrfToken: csrf })))
            .status,
        403
    );
    assert.equal(deleted, 0);
    assert.equal(debugCalls, 3);
    const failedDelete = await request(
        '/threads/123/delete',
        form({ csrfToken: csrf })
    );
    assert.doesNotMatch(
        await failedDelete.text(),
        /synthetic-private-token-message/
    );
    const failedDetail = await request('/threads/123');
    assert.doesNotMatch(
        await failedDetail.text(),
        /synthetic-private-token-message/
    );
    assert.doesNotMatch(
        request.logs.join(' '),
        /synthetic-private-token-message/
    );
});

test('Postman preserves exact OAuth IDs and permits only the profile bootstrap alias', () => {
    const collection = JSON.parse(
        fs.readFileSync(
            path.join(
                __dirname,
                '../postman/threads-api.postman_collection.json'
            ),
            'utf8'
        )
    );
    const items = [];
    function visit(children) {
        for (const item of children) {
            if (item.item) visit(item.item);
            if (item.request) items.push(item);
        }
    }
    visit(collection.item);
    const bootstrap = items.find(
        (item) => item.name === "Get App-Scoped User's Profile Information"
    );
    assert.deepEqual(bootstrap.request.url.path, ['me']);
    assert.equal(
        bootstrap.request.url.raw,
        '{{api_host}}/me?fields={{fields_profile}}'
    );
    assert.ok(
        items.every(
            (item) => item === bootstrap || item.request.url.path[0] !== 'me'
        ),
        'Only the profile bootstrap may use the alias.'
    );
    const profileScript = bootstrap.event[0].script.exec.join('\n');
    for (const autoSave of ['false', 'true']) {
        const vars = new Map([
            ['auto_save_variables', autoSave],
            ['user_id', ''],
        ]);
        vm.runInNewContext(profileScript, {
            pm: {
                response: { json: () => ({ id: userId }) },
                collectionVariables: {
                    get: (key) => vars.get(key),
                    set: (key, value) => vars.set(key, value),
                },
            },
        });
        assert.equal(vars.get('user_id'), autoSave === 'true' ? userId : '');
    }
    const script = items
        .find((item) => item.name === 'Exchange the Code For a Token')
        .event[0].script.exec.join('\n');
    for (const raw of [
        `{"access_token":"synthetic-token","user_id":${userId},"data":{"user_id":"999"}}`,
        '{"access_token":"synthetic-token","data":{"user_id":"999"}}',
    ]) {
        const vars = new Map([
            ['auto_save_variables', 'true'],
            ['user_id', 'stale'],
        ]);
        vm.runInNewContext(script, {
            pm: {
                response: { code: 200, text: () => raw },
                collectionVariables: {
                    get: (k) => vars.get(k),
                    set: (k, v) => vars.set(k, v),
                    unset: (k) => vars.delete(k),
                },
            },
        });
        assert.equal(
            vars.get('user_id'),
            raw.includes(`:${userId}`) ? userId : undefined
        );
    }
});
