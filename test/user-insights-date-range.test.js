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
const { DateTime } = require('luxon');
const entry = path.join(__dirname, '../src/index.js');
const appRequire = createRequire(entry);

async function startApp(t, initialTime, signedIn = true) {
    let now = initialTime;
    const calls = [];
    const app = vm.runInNewContext(fs.readFileSync(entry, 'utf8') + '\napp;', {
        __dirname: path.dirname(entry),
        process: {
            env: {
                SESSION_SECRET: 'synthetic-date-secret',
                ...(signedIn && {
                    INITIAL_ACCESS_TOKEN: 'synthetic-date-token',
                    INITIAL_USER_ID: '456',
                }),
            },
        },
        console: { log() {}, error() {}, warn() {} },
        require(name) {
            if (name === 'luxon')
                return {
                    DateTime: class extends DateTime {
                        static utc() {
                            return DateTime.fromISO(now, {
                                setZone: true,
                            }).toUTC();
                        }
                    },
                };
            if (name === 'axios')
                return {
                    async get(url, options) {
                        assert.ok(options.httpsAgent);
                        calls.push(new URL(url));
                        return {
                            data: {
                                data: [
                                    {
                                        name: 'views',
                                        id: 'example-views',
                                        values: [{ value: 0 }],
                                    },
                                    {
                                        name: 'likes',
                                        id: 'example-likes',
                                        total_value: { value: 0 },
                                    },
                                    {
                                        name: 'clicks',
                                        id: 'example-clicks',
                                        link_total_values: [{ value: 0 }],
                                    },
                                ],
                            },
                        };
                    },
                };
            if (name === 'dotenv') return { config() {} };
            if (name === 'fs') return { readFileSync: () => '' };
            if (name === 'https')
                return { ...https, createServer: () => ({ listen() {} }) };
            return appRequire(name);
        },
    });
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    return {
        calls,
        setTime(value) {
            now = value;
        },
        async request(query = '') {
            const response = await fetch(
                `${base}/userInsights${query ? '?' + query : ''}`,
                {
                    redirect: 'manual',
                    signal: AbortSignal.timeout(10000),
                    headers: cookie ? { cookie } : {},
                }
            );
            cookie =
                response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
            return response;
        },
    };
}

function assertDateControls(html, cutoff) {
    for (const name of ['since', 'until']) {
        assert.match(
            html,
            new RegExp(`<input id="${name}"[^>]*min="${cutoff}"`)
        );
    }
    assert.match(
        html,
        new RegExp(
            `Choose dates on or after ${cutoff}\\. The cutoff uses UTC\\.`
        )
    );
    assert.doesNotMatch(html, /type="date"[^>]*max=/);
}

test('both date controls use the UTC calendar-year cutoff, including leap days and year boundaries', async (t) => {
    for (const [now, cutoff, older] of [
        ['2026-11-24T00:00:00Z', '2024-11-24', '2024-11-23'],
        ['2024-02-29T12:00:00Z', '2022-02-28', '2022-02-27'],
        ['2028-02-29T12:00:00Z', '2026-02-28', '2026-02-27'],
        ['2026-03-01T00:00:00Z', '2024-03-01', '2024-02-29'],
        ['2026-12-31T19:00:00-06:00', '2025-01-01', '2024-12-31'],
    ]) {
        const { request, calls } = await startApp(t, now);
        const response = await request(`since=${cutoff}&until=${cutoff}`);
        assert.equal(response.status, 200);
        assertDateControls(await response.text(), cutoff);
        assert.equal(calls.length, 1);
        for (const name of ['since', 'until']) {
            const rejected = await request(`${name}=${older}`);
            assert.equal(rejected.status, 400);
            assertDateControls(await rejected.text(), cutoff);
            assert.equal(
                calls.length,
                1,
                'Older filters stop before the API request.'
            );
        }
    }
});

test('invalid, malformed, and reversed filters fail before API requests and preserve the form safely', async (t) => {
    const { request, calls } = await startApp(t, '2026-11-24T12:00:00Z');
    for (const name of ['since', 'until']) {
        for (const value of [
            '2026-02-29',
            '2026-13-01',
            '2026-04-31',
            '2026-1-01',
            '2026-01-01T00:00:00Z',
            '1767225600',
            '<script>invalid</script>',
        ]) {
            const query = new URLSearchParams({
                [name]: value,
                [name === 'since' ? 'until' : 'since']: '2026-01-31',
            });
            const response = await request(query.toString());
            assert.equal(response.status, 400);
            const html = await response.text();
            assert.match(html, /Enter valid dates in YYYY-MM-DD format\./);
            assert.match(html, /value="2026-01-31"/);
            assert.doesNotMatch(html, /<script>invalid/);
            assertDateControls(html, '2024-11-24');
        }
        for (const shape of [
            `${name}[]=2026-01-01`,
            `${name}[value]=2026-01-01`,
        ]) {
            const response = await request(shape);
            assert.equal(response.status, 400);
            assert.match(
                await response.text(),
                /Enter valid dates in YYYY-MM-DD format\./
            );
        }
    }
    const reversed = await request('since=2026-02-01&until=2026-01-31');
    assert.equal(reversed.status, 400);
    const html = await reversed.text();
    assert.match(html, /Since must be on or before Until\./);
    assert.match(html, /name="since" value="2026-02-01"/);
    assert.match(html, /name="until" value="2026-01-31"/);
    assert.equal(calls.length, 0);
});

test('omitted and accepted filters preserve request parameters, metric order, and zero values', async (t) => {
    const { request, calls } = await startApp(t, '2026-11-24T12:00:00Z');
    for (const values of [
        {},
        { since: '', until: '' },
        { since: '2024-11-24' },
        { until: '2026-01-31' },
        { since: '2026-01-01', until: '2026-01-31' },
        { until: '2028-01-01' },
    ]) {
        const response = await request(new URLSearchParams(values).toString());
        assert.equal(response.status, 200);
        const html = await response.text();
        assertDateControls(html, '2024-11-24');
        assert.equal((html.match(/<td>0<\/td>/g) || []).length, 3);
        assert.doesNotMatch(html, /synthetic-date-token/);
        const url = calls.at(-1);
        assert.equal(url.origin, 'https://graph.threads.com');
        assert.equal(url.pathname, '/456/threads_insights');
        assert.equal(
            url.searchParams.get('metric'),
            'views,likes,replies,quotes,reposts,clicks,followers_count'
        );
        assert.equal(
            url.searchParams.get('access_token'),
            'synthetic-date-token'
        );
        for (const name of ['since', 'until']) {
            assert.equal(url.searchParams.get(name), values[name] || null);
        }
        assert.deepEqual(
            [...url.searchParams.keys()].sort(),
            [
                'metric',
                'access_token',
                ...Object.keys(values).filter((name) => values[name]),
            ].sort()
        );
    }
});

test('the cutoff advances at UTC midnight and signed-out requests make no API calls', async (t) => {
    const app = await startApp(t, '2026-11-24T23:59:59.999Z');
    assert.equal((await app.request('since=2024-11-24')).status, 200);
    app.setTime('2026-11-25T00:00:00Z');
    const response = await app.request('since=2024-11-24');
    assert.equal(response.status, 400);
    assertDateControls(await response.text(), '2024-11-25');
    assert.equal(app.calls.length, 1);
    const signedOut = await startApp(t, '2026-11-24T12:00:00Z', false);
    assert.equal((await signedOut.request('since=2020-01-01')).status, 302);
    assert.equal(signedOut.calls.length, 0);
});
