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
const tokenPattern = /name="csrf-token" content="([a-f0-9]{64})"/;
const csrfFailure = {
    error: true,
    message:
        'The request could not be verified. Reload the page and try again.',
};

async function startApp(t, { api = {}, signedIn = false, onApp } = {}) {
    let parsedForms = 0;
    const app = vm.runInNewContext(fs.readFileSync(entry, 'utf8') + '\napp;', {
        __dirname: path.dirname(entry),
        process: {
            env: {
                SESSION_SECRET: 'synthetic-session-secret',
                ...(signedIn && {
                    INITIAL_ACCESS_TOKEN: 'synthetic-access-token',
                    INITIAL_USER_ID: '456',
                }),
            },
        },
        console: { log() {}, error() {}, warn() {} },
        require(name) {
            if (name === 'axios') return api;
            if (name === 'dotenv') return { config() {} };
            if (name === 'fs') return { readFileSync: () => '' };
            if (name === 'https')
                return { ...https, createServer: () => ({ listen() {} }) };
            if (name === 'multer') {
                return () => ({
                    array() {
                        const parse = appRequire('multer')().array();
                        return (req, res, next) => {
                            parsedForms++;
                            parse(req, res, next);
                        };
                    },
                });
            }
            return appRequire(name);
        },
    });
    onApp?.(app);
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    return {
        parsedForms: () => parsedForms,
        client() {
            let cookie;
            return async (route, options = {}) => {
                assert.ok(route.startsWith('/') && !route.startsWith('//'));
                const response = await fetch(base + route, {
                    ...options,
                    redirect: 'manual',
                    signal: AbortSignal.timeout(10000),
                    headers: { ...(cookie && { cookie }), ...options.headers },
                });
                cookie =
                    response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
                return response;
            };
        },
    };
}

async function csrfFromPage(request) {
    const response = await request('/');
    if (response.status === 302) {
        // The synthetic bootstrap redirects once without making an API call.
        return csrfFromPage(request);
    }
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const match = (await response.text()).match(tokenPattern);
    assert.ok(match, 'The page exposes its session token.');
    return match[1];
}

function post(request, route, body, headerToken) {
    return request(route, {
        method: 'POST',
        body,
        ...(headerToken !== undefined && {
            headers: { 'X-CSRF-Token': headerToken },
        }),
    });
}

test('mutation routes reject invalid session tokens before form parsing or API calls', async (t) => {
    const calls = [];
    const app = await startApp(t, {
        signedIn: true,
        api: {
            post: async (url) => {
                calls.push(new URL(url));
                return { data: { id: '123', success: true } };
            },
        },
    });
    const request = app.client();
    const token = await csrfFromPage(request);
    const foreignToken = await csrfFromPage(app.client());
    assert.notEqual(token, foreignToken);
    assert.equal(await csrfFromPage(request), token);

    const multipart = new FormData();
    multipart.set('text', 'Synthetic post');
    multipart.set('topicTag', '');
    multipart.set('_csrf', token);
    for (const route of [
        '/upload',
        '/publish',
        '/repost',
        '/manage_reply/123',
        '/threads/123/delete',
        '/logout',
    ]) {
        const response = await post(request, route, multipart);
        assert.equal(response.status, 403, route);
        assert.deepEqual(await response.json(), csrfFailure);
    }
    const native = new URLSearchParams({ _csrf: token, repostId: '123' });
    for (const [route, body, header] of [
        [`/repost?_csrf=${token}`, new URLSearchParams({ repostId: '123' })],
        ['/repost', native, foreignToken],
        ['/repost', native, ''],
        [
            '/repost',
            new URLSearchParams([
                ['_csrf', token],
                ['_csrf', token],
            ]),
        ],
    ]) {
        const response = await post(request, route, body, header);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), csrfFailure);
    }
    assert.equal(app.parsedForms(), 0);
    assert.equal(calls.length, 0);

    assert.equal((await post(request, '/repost', native)).status, 302);
    multipart.delete('_csrf');
    assert.equal(
        (await post(request, '/upload', multipart, token)).status,
        200
    );
    assert.equal(
        (
            await post(
                request,
                '/manage_reply/123?hide=true',
                new FormData(),
                token
            )
        ).status,
        200
    );
    assert.equal(app.parsedForms(), 3);
    assert.deepEqual(
        calls.map((url) => url.pathname),
        ['/123/repost', '/456/threads', '/123/manage_reply']
    );
    assert.ok(
        calls.every(
            (url) =>
                !url.searchParams.has('_csrf') &&
                !url.toString().includes(token)
        )
    );
});

test('logout is a protected native POST and invalidates the old session token', async (t) => {
    const app = await startApp(t, { signedIn: true });
    const request = app.client();
    const token = await csrfFromPage(request);
    const home = await (await request('/')).text();
    assert.ok(home.includes('action="/logout" method="POST"'));
    assert.ok(home.includes(`name="_csrf" value="${token}"`));
    assert.equal((await request('/logout')).status, 404);
    assert.equal((await request('/upload')).status, 200);
    const signedOut = await post(
        request,
        '/logout',
        new URLSearchParams({ _csrf: token })
    );
    assert.equal(signedOut.status, 200);
    assert.doesNotMatch(await signedOut.text(), tokenPattern);
    assert.equal((await request('/upload')).status, 302);
    assert.equal(
        (await post(request, '/logout', new URLSearchParams({ _csrf: token })))
            .status,
        403
    );
    assert.notEqual(await csrfFromPage(request), token);
});

test('OAuth state is separate, session-bound, and consumed before code exchange', async (t) => {
    let exchanges = 0;
    let exchangeStarted;
    let finishExchange;
    const started = new Promise((resolve) => {
        exchangeStarted = resolve;
    });
    const gate = new Promise((resolve) => {
        finishExchange = resolve;
    });
    let writerStarted;
    let finishWriter;
    const writing = new Promise((resolve) => {
        writerStarted = resolve;
    });
    const writerGate = new Promise((resolve) => {
        finishWriter = resolve;
    });
    const app = await startApp(t, {
        onApp(app) {
            app.get('/_test/stale-session', async (req, res) => {
                // Simulate an ordinary request saving an older state-bearing snapshot.
                req.session.oauthState = req.query.state;
                req.session.deleteCsrfToken = 'synthetic-session-update';
                writerStarted();
                await writerGate;
                res.sendStatus(204);
            });
        },
        api: {
            post: async (url, body) => {
                exchanges++;
                assert.equal(new URL(url).pathname, '/oauth/access_token');
                assert.equal(
                    new URLSearchParams(body).get('code'),
                    'synthetic-code'
                );
                if (exchanges === 1) {
                    exchangeStarted();
                    await gate;
                }
                return {
                    data: { access_token: 'synthetic-token', user_id: '456' },
                };
            },
            get: async () => ({ data: {} }),
        },
    });
    const request = app.client();
    const formToken = await csrfFromPage(request);
    const login = async () => {
        const response = await request('/login');
        assert.equal(response.status, 302);
        const state = new URL(
            response.headers.get('location')
        ).searchParams.get('state');
        assert.match(state, /^[a-f0-9]{64}$/);
        assert.notEqual(formToken, state);
        return state;
    };
    const callback = (state) =>
        `/callback?${new URLSearchParams({ code: 'synthetic-code', state })}`;
    const initial = await login();
    assert.equal((await request('/callback?code=synthetic-code')).status, 403);
    assert.equal((await request(callback(formToken))).status, 403);
    assert.equal((await app.client()(callback(initial))).status, 403);
    assert.equal((await request(`/callback?state=${initial}`)).status, 400);
    assert.equal((await request(callback(initial))).status, 403);
    assert.equal(exchanges, 0);

    const current = await login();
    assert.notEqual(initial, current);
    const staleWriter = request(`/_test/stale-session?state=${current}`);
    await writing;
    const attempts = [request(callback(current)), request(callback(current))];
    try {
        const rejected = await Promise.race(attempts);
        assert.equal(rejected.status, 403);
        await started;
        finishWriter();
        assert.equal((await staleWriter).status, 204);
        assert.equal(
            (await request(callback(current))).status,
            403,
            'A stale ordinary session save cannot restore consumed OAuth state.'
        );
    } finally {
        finishWriter();
        finishExchange();
    }
    assert.deepEqual(
        (await Promise.all(attempts)).map((response) => response.status).sort(),
        [302, 403]
    );
    assert.equal((await request(callback(current))).status, 403);
    assert.equal(exchanges, 1);
    assert.equal(await csrfFromPage(request), formToken);
});
