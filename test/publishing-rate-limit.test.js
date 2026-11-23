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

async function startApp(t, signedIn) {
    let calls = 0;
    let parsedForms = 0;
    let authChecks = 0;
    const app = vm.runInNewContext(fs.readFileSync(entry, 'utf8') + '\napp;', {
        __dirname: path.dirname(entry),
        process: {
            env: {
                SESSION_SECRET: 'synthetic-secret',
                ...(signedIn
                    ? {
                          INITIAL_ACCESS_TOKEN: 'synthetic-token',
                          INITIAL_USER_ID: '456',
                      }
                    : {}),
            },
        },
        console: { log() {}, error() {}, warn() {} },
        require(name) {
            if (name === 'axios')
                return {
                    async post(url) {
                        calls++;
                        const parsed = new URL(url);
                        assert.ok(
                            ['/456/threads', '/456/threads_publish'].includes(
                                parsed.pathname
                            )
                        );
                        return { data: { id: '123' } };
                    },
                    get() {
                        assert.fail('Unexpected API read.');
                    },
                };
            if (name === 'multer')
                return () => ({
                    array: () => (req, _res, next) => {
                        parsedForms++;
                        next();
                    },
                });
            if (name === 'dotenv') return { config() {} };
            if (name === 'fs') return { readFileSync: () => '' };
            if (name === 'https')
                return { ...https, createServer: () => ({ listen() {} }) };
            return appRequire(name);
        },
    });
    const routes = ['/upload', '/publish'].map((route) =>
        app._router.stack.find(
            (layer) => layer.route?.path === route && layer.route.methods.post
        )
    );
    assert.ok(routes.every(Boolean));
    assert.strictEqual(
        routes[0].route.stack[0].handle,
        routes[1].route.stack[0].handle,
        'Both routes share one limiter.'
    );
    for (const route of routes) {
        const original = route.route.stack[1].handle;
        route.route.stack[1].handle = (req, res, next) => {
            authChecks++;
            return original(req, res, next);
        };
    }
    const ports = new Map();
    for (const hostname of ['127.0.0.1', '::1']) {
        const server = http.createServer(app);
        t.after(() => new Promise((resolve) => server.close(resolve)));
        server.listen(0, hostname);
        await once(server, 'listening');
        assert.equal(server.address().address, hostname);
        ports.set(hostname, server.address().port);
    }
    const sessions = new Map();
    return {
        counts: () => ({ calls, parsedForms, authChecks }),
        async request(route, hostname = '127.0.0.1') {
            assert.ok(
                ports.has(hostname),
                'Only explicit loopback addresses are allowed.'
            );
            const port = ports.get(hostname);
            const base =
                hostname === '::1'
                    ? `http://[::1]:${port}`
                    : `http://${hostname}:${port}`;
            if (!sessions.has(hostname)) {
                const opts = {
                    redirect: 'manual',
                    signal: AbortSignal.timeout(10000),
                };
                const home = await fetch(base, opts);
                const cookie = home.headers.get('set-cookie').split(';')[0];
                const page =
                    home.status === 302
                        ? await fetch(base + '/oEmbed', {
                              ...opts,
                              headers: { cookie },
                          })
                        : home;
                const csrf = (await page.text()).match(
                    /name="csrf-token" content="([a-f0-9]{64})"/
                )[1];
                sessions.set(hostname, { cookie, 'X-CSRF-Token': csrf });
            }
            const response = await fetch(base + route, {
                method: 'POST',
                redirect: 'manual',
                signal: AbortSignal.timeout(10000),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    ...sessions.get(hostname),
                },
                body: new URLSearchParams({
                    text: 'Synthetic post',
                    topicTag: '',
                    containerId: '123',
                }),
            });
            const body = await response.json();
            return { status: response.status, body, headers: response.headers };
        },
    };
}

function checkBlocked(response) {
    assert.equal(response.status, 429);
    assert.deepEqual(response.body, {
        error: true,
        message: 'Too many publishing requests. Wait a minute and try again.',
    });
    assert.ok(Number(response.headers.get('retry-after')) > 0);
    assert.match(response.headers.get('ratelimit'), /r=0/);
}

test('signed-out publishing attempts share an IP budget and throttling runs before auth or form parsing', async (t) => {
    for (const firstRoute of ['/upload', '/publish']) {
        const app = await startApp(t, false);
        for (let i = 0; i < 20; i++)
            assert.equal((await app.request(firstRoute)).status, 401);
        const before = app.counts();
        checkBlocked(await app.request('/upload'));
        checkBlocked(await app.request('/publish'));
        assert.deepEqual(
            app.counts(),
            before,
            'Blocked requests never reach downstream middleware.'
        );
        assert.deepEqual(before, { calls: 0, parsedForms: 0, authChecks: 20 });
        assert.equal(
            (await app.request('/publish', '::1')).status,
            401,
            'Another IP retains a separate budget.'
        );
    }
});

test('successful publishing requests count toward the shared budget without altering API responses', async (t) => {
    const app = await startApp(t, true);
    for (let i = 0; i < 10; i++) {
        const upload = await app.request('/upload');
        assert.equal(upload.status, 200);
        assert.equal(upload.body.id, '123');
        const publish = await app.request('/publish');
        assert.equal(publish.status, 200);
        assert.equal(publish.body.id, '123');
    }
    assert.deepEqual(app.counts(), {
        calls: 20,
        parsedForms: 20,
        authChecks: 20,
    });
    checkBlocked(await app.request('/upload'));
    checkBlocked(await app.request('/publish'));
    assert.deepEqual(app.counts(), {
        calls: 20,
        parsedForms: 20,
        authChecks: 20,
    });
});
