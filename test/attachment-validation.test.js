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

async function startApp(t, api) {
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
        console: { log() {}, warn() {}, error: (...args) => logs.push(args) },
        require(name) {
            if (name === 'axios') return api;
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
    const home = await fetch(base, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
    });
    assert.equal(home.status, 302);
    const cookie = home.headers.get('set-cookie').split(';')[0];
    const upload = await fetch(base + '/upload', {
        headers: { cookie },
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
    });
    assert.equal(upload.status, 200);
    const csrf = (await upload.text()).match(
        /name="csrf-token" content="([a-f0-9]{64})"/
    )[1];
    return {
        logs,
        request: (route, body) =>
            fetch(base + route, {
                ...(body && { method: 'POST', body }),
                headers: { cookie, 'X-CSRF-Token': csrf },
                redirect: 'manual',
                signal: AbortSignal.timeout(5000),
            }),
    };
}

function uploadForm(values = {}) {
    const form = new FormData();
    for (const [name, value] of Object.entries({
        text: 'Example post',
        topicTag: '',
        ...values,
    })) {
        if (Array.isArray(value)) {
            for (const item of value) form.append(`${name}[]`, item);
        } else {
            form.append(name, value);
        }
    }
    return form;
}

async function checkError(response, status, message) {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: true, message });
}

test('upload rejects incompatible attachments before creating any containers', async (t) => {
    const calls = [];
    const { request } = await startApp(t, {
        post: async (url) => {
            calls.push(new URL(url));
            return { data: { id: '123' } };
        },
    });
    const media = {
        attachmentType: ['Image'],
        attachmentUrl: ['https://example.invalid/image.jpg'],
    };
    const poll = { pollOptionA: 'A', pollOptionB: 'B' };
    const link = { linkAttachment: 'https://example.invalid/' };
    for (const values of [
        { ...media, ...link },
        { ...media, ...poll },
        { ...media, autoPublishText: 'on' },
        { ...poll, ...link },
        { pollOptionA: 'A' },
        { ...poll, pollOptionD: 'D' },
        { ...media, attachmentUrl: [' '] },
        { attachmentType: 'Image', attachmentUrl: media.attachmentUrl },
    ]) {
        await checkError(
            await request('/upload', uploadForm(values)),
            400,
            'Check the post options and attachments, then try again.'
        );
    }
    assert.equal(calls.length, 0);
    for (const values of [
        media,
        poll,
        { ...link, autoPublishText: 'on' },
        { ghostPostMedia: 'true' },
        { linkAttachment: '' },
    ]) {
        assert.equal(
            (await request('/upload', uploadForm(values))).status,
            200
        );
    }
    assert.equal(calls.length, 5);
    for (const index of [0, 1, 3, 4]) {
        assert.equal(calls[index].searchParams.has('link_attachment'), false);
    }
    assert.equal(
        calls[2].searchParams.get('link_attachment'),
        link.linkAttachment
    );
    assert.equal(calls[3].searchParams.get('is_ghost_post'), 'true');
    assert.equal(calls[0].searchParams.get('media_type'), 'IMAGE');
    assert.equal(
        calls[0].searchParams.get('image_url'),
        media.attachmentUrl[0]
    );
    assert.equal(
        JSON.parse(calls[1].searchParams.get('poll_attachment')).option_a,
        'A'
    );
    assert.equal(calls[2].searchParams.get('auto_publish_text'), 'true');
});

test('browser rejects incompatible media attachments before submitting', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../public/scripts/form.js'),
        'utf8'
    );
    const warnings = [];
    const validate = vm.runInNewContext(source + '\nisFormDataValid;', {
        document: { addEventListener() {} },
        alert: (message) => warnings.push(message),
    });
    for (const fields of [
        {
            'attachmentType[]': 'Image',
            linkAttachment: 'https://example.invalid/',
        },
        { 'attachmentType[]': 'Video', pollOptionA: 'A', pollOptionB: 'B' },
    ]) {
        const form = new FormData();
        for (const [name, value] of Object.entries(fields))
            form.set(name, value);
        assert.equal(validate(form), false);
    }
    assert.deepEqual(warnings, [
        'Link attachments can only be used with text posts.',
        'Poll attachments can only be used with text posts.',
    ]);
});
