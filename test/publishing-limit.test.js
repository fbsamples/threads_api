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
const appRequire = createRequire(entry);
const fields =
    'quota_usage,config,reply_quota_usage,reply_config,delete_quota_usage,delete_config,location_search_quota_usage,location_search_config';
const unavailable = 'Not Available';

async function startApp(t, get) {
    const logs = [];
    const app = vm.runInNewContext(fs.readFileSync(entry, 'utf8') + '\napp;', {
        __dirname: path.dirname(entry),
        process: {
            env: {
                SESSION_SECRET: 'synthetic-secret',
                INITIAL_ACCESS_TOKEN: 'synthetic-token',
                INITIAL_USER_ID: '456',
            },
        },
        console: { log() {}, error: (...args) => logs.push(args) },
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
    const url = `http://127.0.0.1:${server.address().port}/publishingLimit`;
    let cookie;
    return {
        logs,
        async request(headers = {}) {
            const response = await fetch(url, {
                redirect: 'manual',
                signal: AbortSignal.timeout(5000),
                headers: { ...(cookie ? { cookie } : {}), ...headers },
            });
            cookie =
                response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
            return {
                status: response.status,
                headers: response.headers,
                html: await response.text(),
            };
        },
    };
}

function rows(html) {
    return Array.from(
        html.matchAll(/<th scope="row">([^<]+)<\/th><td>([^<]+)<\/td>/g),
        (match) => match.slice(1)
    );
}

const emptyRows = ['Publishing', 'Replies', 'Deletion', 'Location Search'].map(
    (name) => [name, unavailable]
);

test('quota rows show the reported units, counts, and readable windows', async (t) => {
    const { request } = await startApp(t, async (url) => {
        const parsed = new URL(url);
        assert.equal(parsed.pathname, '/456/threads_publishing_limit');
        assert.equal(parsed.searchParams.get('fields'), fields);
        return {
            data: {
                data: [
                    {
                        quota_usage: 1,
                        config: { quota_total: 250, quota_duration: 86400 },
                        reply_quota_usage: 0,
                        reply_config: { quota_total: 0, quota_duration: 5400 },
                        delete_quota_usage: 1,
                        delete_config: {
                            quota_total: 1,
                            quota_duration: 172800,
                        },
                        location_search_quota_usage: 4,
                        location_search_config: {
                            quota_total: 2000,
                            quota_duration: 900,
                        },
                    },
                ],
            },
        };
    });
    const { status, html } = await request();
    assert.equal(status, 200);
    assert.deepEqual(rows(html), [
        [
            'Publishing',
            'You published 1 out of 250 posts in the last 24 hours.',
        ],
        [
            'Replies',
            'You posted 0 out of 0 replies in the last 1 hour 30 minutes.',
        ],
        ['Deletion', 'You deleted 1 out of 1 post in the last 2 days.'],
        [
            'Location Search',
            'You made 4 out of 2,000 location search requests in the last 15 minutes.',
        ],
    ]);
    assert.doesNotMatch(html, /86400|Quota Total|Quota Duration/);
});

test('missing and malformed quota fields do not invent usage or duration', async (t) => {
    let result = [];
    const { request } = await startApp(t, async () => ({
        data: { data: result },
    }));
    const empty = await request();
    assert.equal(empty.status, 200);
    assert.deepEqual(rows(empty.html), emptyRows);
    result = [
        {
            quota_usage: 0,
            config: { quota_total: 4, quota_duration: 60 },
            reply_quota_usage: -1,
            reply_config: { quota_total: 10, quota_duration: -1 },
            location_search_quota_usage: '0',
            location_search_config: {
                quota_total: Infinity,
                quota_duration: 60,
            },
        },
    ];
    const partial = await request();
    assert.equal(partial.status, 200);
    assert.deepEqual(rows(partial.html), [
        ['Publishing', 'You published 0 out of 4 posts in the last 1 minute.'],
        ['Replies', unavailable],
        ['Deletion', unavailable],
        ['Location Search', unavailable],
    ]);
});

test('upstream quota failures show a fixed message and never log upstream details', async (t) => {
    const detail = 'Synthetic upstream detail.';
    let result = new Error(detail);
    const { request, logs } = await startApp(t, async () => {
        if (result instanceof Error) throw result;
        return { data: result };
    });
    for (const value of [
        result,
        { data: { message: detail } },
        { data: [null] },
    ]) {
        result = value;
        const { status, html } = await request();
        assert.equal(status, 502);
        assert.ok(
            html.includes('Unable to load quota information. Try again later.')
        );
        assert.ok(!html.includes(detail));
        assert.deepEqual(rows(html), emptyRows);
    }
    assert.deepEqual(logs, []);
});

test('quota reloads request fresh counts and do not reuse an old conditional response', async (t) => {
    let count = 3;
    let reads = 0;
    const { request } = await startApp(t, async () => {
        reads++;
        return {
            data: {
                data: [
                    {
                        quota_usage: count,
                        config: { quota_total: 250, quota_duration: 86400 },
                    },
                ],
            },
        };
    });
    const before = await request();
    assert.equal(before.status, 200);
    assert.equal(before.headers.get('cache-control'), 'no-store');
    assert.equal(
        rows(before.html)[0][1],
        'You published 3 out of 250 posts in the last 24 hours.'
    );
    assert.match(
        before.html,
        /<form action="\/publishingLimit" method="GET"><input type="submit" value="Refresh Counts"><\/form>/
    );
    assert.match(
        before.html,
        /<script src="\/scripts\/publishing-limit\.js" defer><\/script>/
    );
    assert.doesNotMatch(before.html, /synthetic-token/);
    const oldETag = before.headers.get('etag');
    assert.ok(oldETag);
    count = 4;
    const after = await request({ 'If-None-Match': oldETag });
    assert.equal(after.status, 200);
    assert.equal(after.headers.get('cache-control'), 'no-store');
    assert.equal(
        rows(after.html)[0][1],
        'You published 4 out of 250 posts in the last 24 hours.'
    );
    assert.equal(reads, 2);
});

test('returning to a hidden or restored quota page reloads once without polling', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../public/scripts/publishing-limit.js'),
        'utf8'
    );
    function page(hidden = false) {
        const events = {};
        let reloads = 0;
        const document = {
            hidden,
            addEventListener: (name, callback) => {
                events[name] = callback;
            },
        };
        vm.runInNewContext(
            source,
            {
                document,
                window: {
                    addEventListener: (name, callback) => {
                        events[name] = callback;
                    },
                    location: {
                        reload: () => {
                            reloads++;
                        },
                    },
                },
            },
            { timeout: 3000 }
        );
        return { document, events, reloads: () => reloads };
    }
    const visible = page();
    visible.events.pageshow({ persisted: false });
    visible.events.visibilitychange();
    assert.equal(visible.reloads(), 0);
    visible.document.hidden = true;
    visible.events.visibilitychange();
    assert.equal(visible.reloads(), 0);
    visible.document.hidden = false;
    visible.events.visibilitychange();
    visible.events.pageshow({ persisted: true });
    visible.events.visibilitychange();
    assert.equal(visible.reloads(), 1);
    visible.events.pagehide();
    visible.events.pageshow({ persisted: true });
    visible.events.visibilitychange();
    assert.equal(visible.reloads(), 2);
    const restored = page();
    restored.events.pageshow({ persisted: true });
    assert.equal(restored.reloads(), 1);
    const initiallyHidden = page(true);
    initiallyHidden.events.pageshow({ persisted: false });
    assert.equal(initiallyHidden.reloads(), 0);
    initiallyHidden.document.hidden = false;
    initiallyHidden.events.visibilitychange();
    assert.equal(initiallyHidden.reloads(), 1);
});
