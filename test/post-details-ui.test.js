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
const fieldOrder = [
    'Post ID',
    'Author',
    'Creation Date and Time',
    'Post Link',
    'Text',
    'Topic Tag',
    'Media Type',
    'Media URL',
    'Link Attachment URL',
    'GIF URL',
    'Poll',
    'Alt Text',
    'Is Quote Post',
    'Quoted Post',
    'Reposted Post',
    'Replies',
    'Reply Audience',
    'Is Spoiler Media Post',
    'Text Entities',
    'Is Ghost Post',
    'Insights',
    'Reply',
    'Quote',
    'Repost',
    'Delete',
];
const examplePost = {
    text: '<b>Example post</b>',
    username: 'example & author+',
    timestamp: '2023-10-17T05:42:03+0000',
    permalink: 'https://example.com/post',
    topic_tag: 'Example Topic',
    media_type: 'TEXT_POST',
    media_url: `https://example.com/media.mp4?fixture=${'x'.repeat(
        1200
    )}&variant=video`,
    link_attachment_url: `https://example.com/link?fixture=${'z'.repeat(
        1200
    )}&variant=link`,
    gif_url: `https://example.com/media.gif?fixture=${'y'.repeat(
        1200
    )}&variant=gif`,
    poll_attachment: { option_a: 'Example A', option_b: 'Example B' },
    alt_text: '<i>Example alternative text</i>',
    is_quote_post: false,
    quoted_post: { id: '345' },
    reposted_post: { id: '678' },
    is_reply: false,
    reply_audience: 'everyone',
    is_spoiler_media: false,
    text_entities: [{ offset: 0, length: 3, entity_type: 'SPOILER' }],
    ghost_post_status: 'INACTIVE',
};

async function startApp(t, post, owner = '456', probe = {}) {
    const reads = [];
    const runtime = vm.runInNewContext(
        fs.readFileSync(entry, 'utf8') +
            '\n({ app, hasDisplayValue: typeof hasDisplayValue === "function" ? hasDisplayValue : undefined, formatPostTimestamp: typeof formatPostTimestamp === "function" ? formatPostTimestamp : undefined });',
        {
            __dirname: path.dirname(entry),
            process: {
                env: {
                    SESSION_SECRET: 'test-secret',
                    INITIAL_ACCESS_TOKEN: 'test-token',
                    INITIAL_USER_ID: '456',
                },
            },
            console: { log() {}, error() {} },
            require(name) {
                if (name === 'axios')
                    return {
                        get: async (url, config) => {
                            const parsed = new URL(url);
                            const stage =
                                parsed.pathname === '/debug_token'
                                    ? 'token'
                                    : parsed.pathname === '/456'
                                    ? 'user'
                                    : parsed.searchParams.get('fields') ===
                                      'id,media_type,owner'
                                    ? 'owner'
                                    : 'primary';
                            assert.ok(config.httpsAgent);
                            assert.equal(
                                config.maxRedirects,
                                stage === 'primary' ? undefined : 0
                            );
                            if (stage === 'token') {
                                assert.deepEqual(
                                    Array.from(
                                        config.transformResponse,
                                        (fn) => fn.name
                                    ),
                                    ['parseUserIdResponse']
                                );
                            }
                            reads.push(parsed);
                            if (probe.redirectStage === stage) {
                                throw {
                                    response: {
                                        status: 302,
                                        headers: {
                                            location:
                                                'https://example.invalid/redirect-target',
                                        },
                                    },
                                };
                            }
                            if (parsed.pathname === '/debug_token') {
                                if (probe.failToken)
                                    throw new Error(
                                        'Synthetic token probe failure.'
                                    );
                                return {
                                    data: {
                                        data: {
                                            is_valid: probe.tokenValid ?? true,
                                            user_id: probe.tokenUserID ?? '456',
                                        },
                                    },
                                };
                            }
                            if (parsed.pathname === '/456')
                                return { data: { id: probe.userID ?? '456' } };
                            if (
                                parsed.searchParams.get('fields') ===
                                'id,media_type,owner'
                            ) {
                                if (probe.failOwner)
                                    throw new Error(
                                        'Synthetic owner probe failure.'
                                    );
                                return {
                                    data: {
                                        id: probe.postID ?? '123',
                                        media_type:
                                            probe.mediaType ?? 'TEXT_POST',
                                        owner:
                                            owner === undefined
                                                ? undefined
                                                : { id: owner },
                                        ...probe.ownerResponse,
                                    },
                                };
                            }
                            if (post instanceof Error) throw post;
                            return { data: post };
                        },
                    };
                if (name === 'dotenv') return { config() {} };
                if (name === 'fs') return { readFileSync: () => '' };
                if (name === 'https')
                    return { ...https, createServer: () => ({ listen() {} }) };
                return appRequire(name);
            },
        },
        { filename: entry }
    );
    const server = http.createServer(runtime.app);
    const listening = once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    server.listen(0, '127.0.0.1');
    await listening;
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    return {
        ...runtime,
        reads,
        request: async (route) => {
            const response = await fetch(new URL(route, base), {
                redirect: 'manual',
                signal: AbortSignal.timeout(10000),
                headers: cookie ? { cookie } : {},
            });
            cookie =
                response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
            return response;
        },
    };
}

test('post details follow the exact field order with an encoded author link, local-time instant, and guarded Delete', async (t) => {
    const { request, reads } = await startApp(t, examplePost);
    const html = await (await request('/threads/123')).text();
    let previous = -1;
    for (const label of fieldOrder) {
        const index = html.indexOf(`<td>${label}</td>`);
        assert.ok(
            index > previous,
            `${label} is present in the required order.`
        );
        previous = index;
    }
    assert.match(
        html,
        /href="https:\/\/www\.threads\.com\/@example%20%26%20author%2B" target="_blank" rel="noopener noreferrer"/
    );
    assert.match(html, /October 17, 2023 at 5:42 AM UTC/);
    assert.match(
        html,
        /<time datetime="2023-10-17T05:42:03.000Z" data-local-timestamp="">/
    );
    assert.match(html, /src="\/scripts\/local-timestamps.js" defer/);
    assert.match(html, /&lt;b&gt;Example post&lt;\/b&gt;/);
    assert.match(html, /&lt;i&gt;Example alternative text&lt;\/i&gt;/);
    for (const [field, url, label] of [
        ['Media URL', examplePost.media_url, 'View Media File'],
        [
            'Link Attachment URL',
            examplePost.link_attachment_url,
            'View Link Attachment',
        ],
        ['GIF URL', examplePost.gif_url, 'View GIF'],
    ]) {
        const escapedUrl = url.replaceAll('&', '&amp;');
        assert.ok(
            html.includes(
                `<td>${field}</td><td><a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${label}</a></td>`
            ),
            `${field} uses a short label and preserves its full destination.`
        );
    }
    assert.doesNotMatch(
        html,
        /<b>Example post|<i>Example alternative text|test-token|Location ID/
    );
    assert.match(html, /name="csrfToken" value="[a-f0-9]{64}"/);
    assert.match(html, /action="\/threads\/123\/delete" method="POST"/);
    assert.ok(html.includes("location.href='/upload?replyToId=123'"));
    const replyForm = await (await request('/upload?replyToId=123')).text();
    assert.ok(
        replyForm.includes('Replying to <a href="/threads/123">post 123</a>')
    );
    assert.match(replyForm, /name="replyToId" value="123"/);
    assert.match(replyForm, /<h1>Upload \(Reply\)<\/h1>/);
    assert.ok(html.includes("location.href='/upload?quotePostId=123'"));
    const quoteForm = await (await request('/upload?quotePostId=123')).text();
    assert.match(quoteForm, /<h1>Upload \(Quote\)<\/h1>/);
    assert.match(quoteForm, /name="quotePostId" value="123"/);
    assert.match(await (await request('/upload')).text(), /<h1>Upload<\/h1>/);
    assert.match(html, /cannot be undone/);
    assert.equal(reads[0].searchParams.get('fields').includes('owner'), false);
    assert.equal(
        reads[0].searchParams.get('fields').includes('location_id'),
        false
    );
});

test('empty fields are hidden without hiding false or zero, and malformed dates remain escaped', async (t) => {
    const sparse = {
        text: 0,
        username: ' ',
        timestamp: '<script>invalid date</script>',
        topic_tag: '',
        media_type: 'TEXT_POST',
        media_url: null,
        permalink: undefined,
        link_attachment_url: '',
        gif_url: ' ',
        poll_attachment: { option_a: 0, option_b: '' },
        alt_text: null,
        is_quote_post: false,
        quoted_post: {},
        reposted_post: { id: '' },
        reply_audience: [],
        is_spoiler_media: false,
        text_entities: [],
    };
    const { request, hasDisplayValue, formatPostTimestamp } = await startApp(
        t,
        sparse,
        '999'
    );
    for (const value of [null, undefined, '', '  ', [], {}])
        assert.equal(hasDisplayValue(value), false);
    for (const value of [false, 0, '0', [0], { value: 0 }])
        assert.equal(hasDisplayValue(value), true);
    assert.equal(
        formatPostTimestamp('2023-10-17T05:42:03+0000'),
        'October 17, 2023 at 5:42 AM UTC'
    );
    const html = await (await request('/threads/123')).text();
    assert.match(html, /<td>Text<\/td><td class="post-details-text">0<\/td>/);
    assert.match(html, /<td>Is Quote Post<\/td><td>false<\/td>/);
    assert.match(html, /<td>Is Spoiler Media Post<\/td><td>false<\/td>/);
    assert.match(html, /<td>Option A<\/td><td>0<\/td>/);
    assert.match(html, /&lt;script&gt;invalid date&lt;\/script&gt;/);
    for (const label of [
        'Author',
        'Post Link',
        'Topic Tag',
        'Media URL',
        'Link Attachment URL',
        'GIF URL',
        'Alt Text',
        'Quoted Post',
        'Reposted Post',
        'Reply Audience',
        'Text Entities',
        'Is Ghost Post',
        'Insights',
        'Delete',
    ]) {
        assert.ok(!html.includes(`<td>${label}</td>`), `${label} is absent.`);
    }
    assert.doesNotMatch(
        html,
        /<script>invalid date|username=undefined|name="csrfToken"/
    );
    Object.assign(sparse, {
        permalink: 'javascript:alert(1)',
        media_url: 'data:text/html,<script>Example</script>',
        link_attachment_url: 'vbscript:Example',
        gif_url: 'ftp://example.com/fixture',
    });
    const nonWeb = await (await request('/threads/123')).text();
    assert.doesNotMatch(nonWeb, /href="(?:javascript:|data:|vbscript:|ftp:)/i);
    assert.match(nonWeb, /javascript:alert\(1\)/);
    assert.match(
        nonWeb,
        /data:text\/html,&lt;script&gt;Example&lt;\/script&gt;/
    );
    assert.match(nonWeb, /vbscript:Example/);
    assert.match(nonWeb, /ftp:\/\/example.com\/fixture/);
});

test('failed, empty or invalid primary loads do not show post actions or run owner probes', async (t) => {
    for (const result of [
        new Error('<script>Example failure</script>.'),
        {},
        [],
        null,
    ]) {
        const { request, reads } = await startApp(t, result);
        const html = await (await request('/threads/123')).text();
        assert.equal(reads.length, 1);
        assert.match(html, /Error:/);
        assert.doesNotMatch(
            html,
            /action="\/repost"|quotePostId=|replyToId=|\/insights|\/replies|name="csrfToken"|<script>Example failure/
        );
    }
});

test('Insights visibility requires verified ownership independently of deletion eligibility', async (t) => {
    for (const scenario of [
        {
            post: { ...examplePost, media_type: 'REPOST_FACADE' },
            owner: '456',
            insights: true,
            deletion: false,
        },
        {
            post: { ...examplePost, media_type: 'UNSUPPORTED' },
            owner: '456',
            insights: true,
            deletion: false,
        },
        {
            post: { ...examplePost, canViewInsights: false },
            owner: '456',
            insights: true,
            deletion: true,
        },
        {
            post: {
                ...examplePost,
                username: 'same-author',
                canViewInsights: true,
            },
            owner: '999',
            insights: false,
            deletion: false,
        },
        {
            post: { ...examplePost, is_reply: true, canViewInsights: true },
            probe: { ownerResponse: { owner: undefined } },
            insights: false,
            deletion: false,
        },
        {
            post: examplePost,
            probe: { postID: '999' },
            insights: false,
            deletion: false,
        },
        {
            post: examplePost,
            probe: { userID: '999' },
            insights: false,
            deletion: false,
        },
        {
            post: examplePost,
            probe: { tokenUserID: '999' },
            insights: false,
            deletion: false,
        },
        {
            post: examplePost,
            probe: { tokenValid: false },
            insights: false,
            deletion: false,
        },
        {
            post: examplePost,
            probe: { failToken: true },
            insights: false,
            deletion: false,
        },
        {
            post: examplePost,
            probe: { failOwner: true },
            insights: false,
            deletion: false,
        },
        {
            post: examplePost,
            probe: { redirectStage: 'token' },
            insights: false,
            deletion: false,
            expectedReads: 2,
            expectedOwnerReads: 0,
        },
        {
            post: examplePost,
            probe: { redirectStage: 'user' },
            insights: false,
            deletion: false,
            expectedReads: 3,
            expectedOwnerReads: 0,
        },
        {
            post: examplePost,
            probe: { redirectStage: 'owner' },
            insights: false,
            deletion: false,
            expectedReads: 4,
            expectedOwnerReads: 1,
        },
        {
            post: examplePost,
            probe: { mediaType: 'UNSUPPORTED' },
            insights: true,
            deletion: false,
        },
    ]) {
        const { request, reads } = await startApp(
            t,
            scenario.post,
            scenario.owner ?? '456',
            scenario.probe
        );
        const response = await request('/threads/123?owner=456&user_id=456');
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.equal(html.includes('<td>Insights</td>'), scenario.insights);
        assert.equal(
            html.includes('href="/threads/123/insights"'),
            scenario.insights
        );
        assert.equal(
            html.includes('aria-label="Delete Post"'),
            scenario.deletion
        );
        assert.ok(html.includes('<td>Reply</td>'));
        assert.ok(html.includes('<td>Quote</td>'));
        assert.ok(html.includes('<td>Repost</td>'));
        assert.ok(html.includes('&lt;b&gt;Example post&lt;/b&gt;'));
        assert.doesNotMatch(
            html,
            /Synthetic owner probe failure|redirect-target/
        );
        assert.equal(reads[0].pathname, '/123');
        assert.equal(
            reads[0].searchParams.get('fields').includes('owner'),
            false
        );
        assert.equal(
            reads.filter(
                (url) =>
                    url.searchParams.get('fields') === 'id,media_type,owner'
            ).length,
            scenario.expectedOwnerReads ??
                (scenario.probe?.failToken ||
                scenario.probe?.tokenUserID ||
                scenario.probe?.tokenValid === false
                    ? 0
                    : 1)
        );
        assert.equal(
            reads.length,
            scenario.expectedReads ??
                (scenario.probe?.failToken ||
                scenario.probe?.tokenUserID ||
                scenario.probe?.tokenValid === false
                    ? 2
                    : 4)
        );
    }
});
