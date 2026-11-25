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

async function startApp(t, get) {
    const calls = [];
    const app = vm.runInNewContext(fs.readFileSync(entry, 'utf8') + '\napp;', {
        __dirname: path.dirname(entry),
        process: {
            env: {
                SESSION_SECRET: 'synthetic-embed-secret',
                INITIAL_ACCESS_TOKEN: 'synthetic-embed-token',
                INITIAL_USER_ID: '456',
            },
        },
        console: { log() {}, error() {} },
        require(name) {
            if (name === 'axios')
                return {
                    get: async (url, config) => {
                        calls.push(new URL(url));
                        return get(new URL(url), config);
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
    return {
        calls,
        request: (query = '') =>
            fetch(
                `http://127.0.0.1:${server.address().port}/oEmbed${
                    query ? '?' + query : ''
                }`,
                {
                    redirect: 'manual',
                    signal: AbortSignal.timeout(5000),
                }
            ),
    };
}

test('post and profile embeds forward the selected theme without a token and render unchanged HTML', async (t) => {
    const embedHTML =
        '<blockquote data-test-embed="unchanged">Example embed.</blockquote><script async src="https://www.threads.com/embed.js"></script>';
    const { calls, request } = await startApp(t, (api, config) => {
        assert.equal(api.origin, 'https://graph.threads.com');
        assert.equal(api.pathname, '/oembed');
        assert.deepEqual([...api.searchParams.keys()], ['url', 'theme']);
        assert.ok(config.httpsAgent);
        assert.equal(config.maxRedirects, 0);
        return { data: { html: embedHTML, provider_name: 'unused-metadata' } };
    });
    const formats = [
        'https://www.threads.com/@meta/post/DDzbnVKx57R',
        'https://www.threads.com/t/DDzbnVKx57R/',
        'https://www.threads.com/@meta/',
    ];
    for (const [index, url] of formats.entries()) {
        const theme = ['light', 'dark', 'auto'][index];
        const response = await request(
            new URLSearchParams({ url, theme }).toString()
        );
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(
            html.includes(`<div class="embed-preview">${embedHTML}</div>`)
        );
        assert.ok(html.includes(`name="url" value="${url}"`));
        assert.ok(html.includes(`<option value="${theme}" selected>`));
        assert.doesNotMatch(html, /unused-metadata|synthetic-embed-token/);
        assert.equal(calls.at(-1).searchParams.get('url'), url);
        assert.equal(calls.at(-1).searchParams.get('theme'), theme);
    }
    const defaultResponse = await request(
        new URLSearchParams({ url: formats[2] }).toString()
    );
    assert.equal(defaultResponse.status, 200);
    assert.match(
        await defaultResponse.text(),
        /<option value="light" selected>/
    );
    assert.equal(calls.at(-1).searchParams.get('theme'), 'light');
    const collection = JSON.parse(
        fs.readFileSync(
            path.join(
                __dirname,
                '../postman/threads-api.postman_collection.json'
            ),
            'utf8'
        )
    );
    const findEmbed = (items) => {
        for (const item of items) {
            if (item.request?.url?.path?.join('/') === 'oembed') return item;
            if (item.item) {
                const match = findEmbed(item.item);
                if (match) return match;
            }
        }
    };
    const example = findEmbed(collection.item);
    assert.equal(example.name, 'Embed a Threads Post or Profile');
    assert.equal(example.request.auth.type, 'noauth');
    assert.deepEqual(
        example.request.url.query.find((p) => p.key === 'theme'),
        {
            key: 'theme',
            value: 'dark',
            disabled: true,
            description:
                "Choose light, dark, or auto. Light is the default. Auto follows the viewer's display settings.",
        }
    );
});

test('the embed form preserves selections and rejects malformed input before API work', async (t) => {
    const { calls, request } = await startApp(t, () =>
        assert.fail('Unexpected API call.')
    );
    const initial = await request();
    assert.equal(initial.status, 200);
    const html = await initial.text();
    assert.match(html, /Post or Profile URL/);
    assert.match(html, /<option value="light" selected>/);
    assert.ok(html.includes("Auto follows the viewer's display settings."));
    assert.match(
        html,
        /<div class="embed-field"><label for="embed-url">Post or Profile URL<\/label><input[^>]*name="url"[^>]*><\/div>/
    );
    assert.match(
        html,
        /<div class="embed-field"><label for="embed-theme">Theme<\/label><select[^>]*name="theme"[^>]*>[\s\S]*?<\/select><p>Auto follows the viewer's display settings\.<\/p><\/div>/
    );
    for (const query of ['theme=dark', 'url=&theme=auto']) {
        const response = await request(query);
        assert.equal(response.status, 200);
        assert.ok(
            (await response.text()).includes(
                `<option value="${
                    query.endsWith('auto') ? 'auto' : 'dark'
                }" selected>`
            )
        );
    }
    for (const query of [
        'theme=unknown',
        'theme=light&theme=dark',
        'url=a&url=b',
        'theme=%3Cscript%3E&url=%22%3E%3Cimg%3E',
    ]) {
        const response = await request(query);
        assert.equal(response.status, 400);
        const body = await response.text();
        assert.match(body, /Error:/);
        assert.doesNotMatch(body, /<img>/i);
    }
    assert.equal(calls.length, 0);
});

test('failed and unusable embed responses show a fixed error while preserving URL and theme', async (t) => {
    let result;
    const { request } = await startApp(t, () => {
        if (result instanceof Error) throw result;
        return { data: result };
    });
    const url = 'https://www.threads.com/@meta';
    for (const value of [
        new Error('private-upstream-message'),
        null,
        {},
        { html: '' },
        { html: {} },
        { html: '<p>should-not-render</p>', error: true },
    ]) {
        result = value;
        const response = await request(
            new URLSearchParams({ url, theme: 'dark' }).toString()
        );
        assert.equal(response.status, 502);
        const html = await response.text();
        assert.match(
            html,
            /Unable to load this embed\. Check the URL and try again\./
        );
        assert.ok(html.includes(`name="url" value="${url}"`));
        assert.match(html, /<option value="dark" selected>/);
        assert.doesNotMatch(html, /should-not-render|private-upstream-message/);
    }
});
