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
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const entry = path.join(__dirname, '../src/index.js');
const loader = createRequire(entry);

async function startApp(t) {
    let exchanges = 0;
    const app = vm.runInNewContext(fs.readFileSync(entry, 'utf8') + '\napp;', {
        __dirname: path.dirname(entry),
        process: {
            env: {
                SESSION_SECRET: 'synthetic-secret',
                INITIAL_ACCESS_TOKEN: 'synthetic-token',
                INITIAL_USER_ID: '456',
            },
        },
        console: { log() {}, error() {}, warn() {} },
        require(name) {
            if (name === 'dotenv') return { config() {} };
            if (name === 'fs') return { readFileSync: () => '' };
            if (name === 'https')
                return { ...https, createServer: () => ({ listen() {} }) };
            if (name === 'axios')
                return {
                    async post(url) {
                        assert.equal(
                            new URL(url).pathname,
                            '/oauth/access_token'
                        );
                        exchanges++;
                        return {
                            data: {
                                access_token: 'synthetic-new-token',
                                user_id: '456',
                            },
                        };
                    },
                    async get(url) {
                        assert.equal(new URL(url).pathname, '/access_token');
                        return {
                            data: { access_token: 'synthetic-long-token' },
                        };
                    },
                };
            return loader(name);
        },
    });
    const login = app._router.stack.find(
        (layer) => layer.route?.path === '/login'
    );
    const callback = app._router.stack.find(
        (layer) => layer.route?.path === '/callback'
    );
    const logout = app._router.stack.find(
        (layer) => layer.route?.path === '/logout'
    );
    assert.strictEqual(
        login.route.stack[0].handle,
        callback.route.stack[0].handle
    );
    assert.notStrictEqual(
        login.route.stack[0].handle,
        logout.route.stack[0].handle
    );
    const server = http.createServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return {
        exchanges: () => exchanges,
        resetSignInBudget() {
            login.route.stack[0].handle.resetKey('127.0.0.1');
        },
        client() {
            let cookie;
            return async (route, options = {}) => {
                assert.ok(route.startsWith('/') && !route.startsWith('//'));
                const response = await fetch(
                    `http://127.0.0.1:${server.address().port}${route}`,
                    {
                        ...options,
                        redirect: 'manual',
                        signal: AbortSignal.timeout(10000),
                        headers: {
                            ...(cookie ? { cookie } : {}),
                            ...options.headers,
                        },
                    }
                );
                cookie =
                    response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
                return {
                    status: response.status,
                    body: await response.text(),
                    headers: response.headers,
                };
            };
        },
    };
}
async function token(client) {
    let home = await client('/');
    if (home.status === 302) home = await client('/');
    assert.equal(home.status, 200);
    const value = home.body.match(/name="csrf-token" content="([a-f0-9]{64})"/);
    assert.ok(value);
    return value[1];
}
const signOut = (client, csrf) =>
    client('/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf }),
    });
function checkSignInLimit(response) {
    assert.equal(response.status, 429);
    assert.match(
        response.body,
        /Too many sign-in requests\. Wait a minute and try again\./
    );
    assert.ok(Number(response.headers.get('retry-after')) > 0);
}

test('login and callback share a budget without consuming blocked state or preventing logout', async (t) => {
    const app = await startApp(t);
    const client = app.client();
    const csrf = await token(client);
    const login = await client('/login');
    assert.equal(login.status, 302);
    const state = new URL(login.headers.get('location')).searchParams.get(
        'state'
    );
    assert.match(state, /^[a-f0-9]{64}$/);
    for (let i = 0; i < 19; i++)
        assert.equal(
            (await client('/callback?code=synthetic-code&state=wrong')).status,
            403
        );
    const callback = `/callback?${new URLSearchParams({
        code: 'synthetic-code',
        state,
    })}`;
    checkSignInLimit(await client(callback));
    checkSignInLimit(await client('/login'));
    assert.equal(app.exchanges(), 0);
    // Reset only the test app's local budget, rather than waiting or changing production time.
    app.resetSignInBudget();
    assert.equal(
        (await client(callback)).status,
        302,
        'The rejected callback and login left the original state available.'
    );
    assert.equal(app.exchanges(), 1);
    assert.equal(
        (await client(callback)).status,
        403,
        'Successful callbacks still consume their state once.'
    );
    for (let i = 0; i < 18; i++)
        await client('/callback?code=synthetic-code&state=wrong');
    checkSignInLimit(await client('/login'));
    assert.equal(
        (await signOut(client, csrf)).status,
        200,
        'Exhausted sign-in capacity does not block a valid logout.'
    );
    assert.equal((await client('/upload')).status, 302);
    assert.equal(app.exchanges(), 1);
});

test('logout has a separate budget and rejected logout preserves the authenticated session', async (t) => {
    const app = await startApp(t);
    const authenticated = app.client();
    const csrf = await token(authenticated);
    assert.equal((await authenticated('/upload')).status, 200);
    for (let i = 0; i < 20; i++) {
        const other = app.client();
        const otherCsrf = await token(other);
        assert.equal((await signOut(other, otherCsrf)).status, 200);
    }
    const blocked = await signOut(authenticated, csrf);
    assert.equal(blocked.status, 429);
    assert.deepEqual(JSON.parse(blocked.body), {
        error: true,
        message: 'Too many sign-out requests. Wait a minute and try again.',
    });
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal(
        (await authenticated('/upload')).status,
        200,
        'Throttled logout must not destroy the session.'
    );
    assert.equal(await token(authenticated), csrf);
    assert.equal(
        (await authenticated('/login')).status,
        302,
        'Logout traffic does not consume the sign-in budget.'
    );
    const noToken = await authenticated('/logout', { method: 'POST' });
    assert.equal(
        noToken.status,
        403,
        'CSRF rejection still precedes the logout limiter.'
    );
    assert.equal(app.exchanges(), 0);
});
