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

test('Post Details rejects excess requests before authentication and API work', async (t) => {
    for (const signedIn of [false, true]) {
        let reads = 0;
        let authChecks = 0;
        const app = vm.runInNewContext(
            fs.readFileSync(entry, 'utf8') + '\napp;',
            {
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
                    if (name === 'dotenv') return { config() {} };
                    if (name === 'fs') return { readFileSync: () => '' };
                    if (name === 'https')
                        return {
                            ...https,
                            createServer: () => ({ listen() {} }),
                        };
                    if (name === 'axios')
                        return {
                            async get(url) {
                                reads++;
                                assert.equal(new URL(url).pathname, '/123');
                                return {
                                    data: { id: '123', text: 'Synthetic post' },
                                };
                            },
                        };
                    return loader(name);
                },
            }
        );
        const route = app._router.stack.find(
            (layer) =>
                layer.route?.path === '/threads/:threadId' &&
                layer.route.methods.get
        );
        const auth = route.route.stack[1].handle;
        route.route.stack[1].handle = (req, res, next) => {
            authChecks++;
            return auth(req, res, next);
        };
        const server = http.createServer(app);
        t.after(() => new Promise((resolve) => server.close(resolve)));
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        let cookie;
        const request = async (route) => {
            const res = await fetch(
                `http://127.0.0.1:${server.address().port}${route}`,
                {
                    redirect: 'manual',
                    signal: AbortSignal.timeout(10000),
                    headers: cookie ? { cookie } : {},
                }
            );
            cookie = res.headers.get('set-cookie')?.split(';')[0] ?? cookie;
            return {
                status: res.status,
                text: await res.text(),
                headers: res.headers,
            };
        };
        for (let i = 0; i < 60; i++) {
            const res = await request('/threads/123');
            assert.equal(res.status, signedIn ? 200 : 302);
            if (signedIn) assert.match(res.text, /Synthetic post/);
        }
        const before = { reads, authChecks };
        const blocked = await request('/threads/123');
        assert.equal(blocked.status, 429);
        assert.match(
            blocked.text,
            /Too many post detail requests\. Wait a minute and try again\./
        );
        assert.ok(Number(blocked.headers.get('retry-after')) > 0);
        assert.deepEqual({ reads, authChecks }, before);
        assert.equal(authChecks, 60);
        assert.equal(reads, signedIn ? 60 : 0);
        assert.equal(
            (await request('/upload')).status,
            signedIn ? 200 : 302,
            'The Post Details budget does not throttle unrelated GET routes.'
        );
    }
});
