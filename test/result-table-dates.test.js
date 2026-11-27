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
const resultRoutes = [
    ['/threads', '/456/threads'],
    ['/replies', '/456/replies'],
    ['/threads/123/replies', '/123/replies'],
    ['/threads/123/conversation', '/123/conversation'],
    ['/mentions', '/456/mentions'],
    ['/profileLookup', '/profile_posts'],
];

async function startApp(t, get) {
    const app = vm.runInNewContext(fs.readFileSync(entry, 'utf8') + '\napp;', {
        __dirname: path.dirname(entry),
        process: {
            env: {
                SESSION_SECRET: 'test-session-secret',
                INITIAL_ACCESS_TOKEN: 'test-access-token',
                INITIAL_USER_ID: '456',
            },
        },
        console: { log() {}, error() {} },
        require(name) {
            if (name === 'axios') return { get };
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
    return async (route) => {
        const response = await fetch(new URL(route, base), {
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
            headers: cookie ? { cookie } : {},
        });
        cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
        return response;
    };
}

function timestampCells(html) {
    return Array.from(
        html.matchAll(
            /<td class="(?:thread|reply)-timestamp">([\s\S]*?)<\/td>/g
        ),
        (match) => match[1].replace(/^<time[^>]*>([\s\S]*)<\/time>$/, '$1')
    );
}

test('result tables expose validated local-time instants without changing API values, paging, or controls', async (t) => {
    const timestamps = [
        '2026-11-17T10:15:00+0000',
        '2026-11-17T01:15:00+02:00',
        '2026-11-17T10:15:00',
        '2026-02-30T10:15:00Z',
        '<script>invalid date</script>',
        null,
        undefined,
        '',
        0,
    ];
    const rows = timestamps.map((timestamp, index) => ({
        id: String(123 + index),
        username: 'example-replier',
        text: 'Example post',
        media_type: 'TEXT_POST',
        timestamp,
        permalink: 'https://example.com/post',
        hide_status: 'UNHIDDEN',
    }));
    const original = rows.map((row) => ({ ...row }));
    const reads = [];
    const request = await startApp(t, async (url) => {
        const api = new URL(url);
        reads.push(api);
        if (api.pathname === '/profile_lookup')
            return { data: { name: 'Example Profile' } };
        assert.ok(
            resultRoutes.some(([, endpoint]) => endpoint === api.pathname)
        );
        return {
            data: {
                data: rows,
                paging: {
                    next: `https://graph.threads.com${api.pathname}?after=forward%2B&limit=3&username=example-owner&access_token=test-paging-token`,
                },
            },
        };
    });
    const expected = [
        'November 17, 2026 at 10:15 AM UTC',
        'November 16, 2026 at 11:15 PM UTC',
        'November 17, 2026 at 10:15 AM UTC',
        '2026-02-30T10:15:00Z',
        '&lt;script&gt;invalid date&lt;/script&gt;',
        '',
        '',
        '',
        '0',
    ];
    for (const [route, endpoint] of resultRoutes) {
        const response = await request(
            `${route}?username=example-owner&after=incoming%2B&limit=3`
        );
        assert.equal(response.status, 200, route);
        const html = await response.text();
        assert.deepEqual(timestampCells(html), expected, route);
        assert.deepEqual(
            [
                ...html.matchAll(
                    /<time datetime="([^"]+)" data-local-timestamp="">/g
                ),
            ].map((match) => match[1]),
            [
                '2026-11-17T10:15:00.000Z',
                '2026-11-16T23:15:00.000Z',
                '2026-11-17T10:15:00.000Z',
            ],
            'Only valid timestamps expose normalized instants for browser conversion.'
        );
        assert.match(html, /src="\/scripts\/local-timestamps.js" defer/);
        assert.match(html, /<th>Post ID<\/th>/);
        assert.doesNotMatch(html, /<th>ID<\/th>/);
        assert.match(html, /href="\/threads\/123"/);
        assert.match(html, /<th>Creation Date and Time<\/th>/);
        assert.doesNotMatch(html, /<th>Created On<\/th>|<script>invalid date/);
        assert.doesNotMatch(html, /test-access-token|test-paging-token/);
        const api = reads.at(-1);
        assert.equal(api.pathname, endpoint);
        assert.equal(api.searchParams.get('after'), 'incoming+');
        assert.equal(api.searchParams.get('limit'), '3');
        assert.ok(
            api.searchParams.get('fields').split(',').includes('timestamp')
        );
        const next = new URL(
            html
                .match(/<a href="([^"]+)">Next<\/a>/)[1]
                .replaceAll('&amp;', '&')
        );
        assert.equal(next.pathname, route);
        assert.equal(next.searchParams.get('after'), 'forward+');
        assert.equal(next.searchParams.get('limit'), '3');
        assert.equal(next.searchParams.has('access_token'), false);
        if (route === '/threads')
            assert.match(html, /action="\/threads\/123\/delete" method="POST"/);
        if (route === '/threads/123/replies') {
            assert.match(html, /class="hide-reply"/);
            assert.match(html, /value="Hide"/);
        } else {
            assert.doesNotMatch(html, /class="hide-reply"/);
        }
        assert.deepEqual(
            rows,
            original,
            'Formatting does not mutate API data.'
        );
    }
});

test('token dates expose valid epoch instants, including zero, without marking invalid fallbacks', async (t) => {
    let metadata;
    let calls = 0;
    const request = await startApp(t, async (url) => {
        assert.equal(new URL(url).pathname, '/debug_token');
        calls++;
        return { data: { data: metadata } };
    });
    const base = {
        user_id: '456',
        scopes: [
            'threads_basic',
            'threads_content_publish',
            '<script>synthetic permission</script>',
        ],
        application: 'Synthetic Test App',
    };
    for (const scenario of [
        {
            data: {
                ...base,
                issued_at: 0,
                expires_at: Date.parse('2026-11-23T22:00:00Z') / 1000,
            },
            status: 200,
            instants: ['1970-01-01T00:00:00.000Z', '2026-11-23T22:00:00.000Z'],
        },
        {
            data: { ...base, issued_at: 1e100, expires_at: 1e100 },
            status: 200,
            instants: [],
        },
        { data: undefined, status: 502, instants: [] },
    ]) {
        metadata = scenario.data;
        const response = await request('/debug');
        assert.equal(response.status, scenario.status);
        const html = await response.text();
        assert.deepEqual(
            [
                ...html.matchAll(
                    /<time datetime="([^"]+)" data-local-timestamp="">/g
                ),
            ].map((match) => match[1]),
            scenario.instants,
            'Only valid epoch seconds expose a browser-local instant, and zero is retained.'
        );
        if (scenario.instants.length === 0) {
            assert.doesNotMatch(html, /<time\b[^>]*data-local-timestamp/);
        }
        assert.match(html, /<th colspan="2">Permissions<\/th>/);
        assert.doesNotMatch(html, /<th colspan="2">Scopes<\/th>/);
        if (metadata) {
            assert.ok(
                html.includes(
                    '<ul><li>threads_basic</li><li>threads_content_publish</li><li>&lt;script&gt;synthetic permission&lt;/script&gt;</li></ul>'
                )
            );
            assert.deepEqual(
                metadata.scopes,
                base.scopes,
                'Rendering preserves permissions and their order.'
            );
        } else {
            assert.doesNotMatch(html, /<ul>/);
        }
        assert.doesNotMatch(html, /<script>synthetic permission/);
        assert.match(html, /src="\/scripts\/local-timestamps.js" defer/);
        assert.doesNotMatch(html, /test-access-token/);
    }
    assert.equal(calls, 3);
});

test('empty and failed result loads still render without timestamp errors', async (t) => {
    for (const fails of [false, true]) {
        const request = await startApp(t, async (url) => {
            if (fails) throw new Error('Synthetic API failure.');
            if (new URL(url).pathname === '/profile_lookup')
                return { data: { name: 'Example Profile' } };
            return { data: { data: [] } };
        });
        for (const [route] of resultRoutes) {
            const response = await request(`${route}?username=example-owner`);
            const unavailableProfile = fails && route === '/profileLookup';
            assert.equal(
                response.status,
                unavailableProfile ? 502 : 200,
                route
            );
            const html = await response.text();
            assert.deepEqual(timestampCells(html), [], route);
            if (unavailableProfile) {
                assert.doesNotMatch(html, /<table/);
            } else {
                assert.match(html, /<th>Creation Date and Time<\/th>/);
            }
            assert.doesNotMatch(
                html,
                /TypeError|ReferenceError|Invalid DateTime/
            );
        }
    }
});
