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

const entryPath = path.join(__dirname, '../src/index.js');
const appRequire = createRequire(entryPath);

async function startApp(t, get, authenticated = true) {
    const app = vm.runInNewContext(
        fs.readFileSync(entryPath, 'utf8') + '\napp;',
        {
            __dirname: path.dirname(entryPath),
            process: {
                env: {
                    SESSION_SECRET: 'test-session-secret',
                    ...(authenticated && {
                        INITIAL_ACCESS_TOKEN: 'test-access-token',
                        INITIAL_USER_ID: 'test-user',
                    }),
                },
            },
            console: { log() {}, error() {} },
            require(name) {
                if (name === 'axios') return { get };
                if (name === 'dotenv') return { config() {} };
                if (name === 'fs') return { readFileSync: () => '' };
                if (name === 'https') {
                    return {
                        ...https,
                        createServer: () => ({ listen() {} }),
                    };
                }
                return appRequire(name);
            },
        },
        { filename: entryPath }
    );
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    return async (url) => {
        const response = await fetch(new URL(url, baseUrl), {
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
            headers: cookie ? { cookie } : {},
        });
        cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
        return response;
    };
}

function pagingLink(html, label) {
    const match = html.match(new RegExp(`<a href="([^"]+)">${label}</a>`));
    assert.ok(match, `${label} link is present`);
    return new URL(match[1].replaceAll('&amp;', '&'));
}

test('search pagination keeps the query, replaces cursors, and excludes tokens', async (t) => {
    const calls = [];
    const request = await startApp(t, async (url) => {
        const apiUrl = new URL(url);
        calls.push(apiUrl);
        const paging = apiUrl.searchParams.has('after')
            ? {
                  previous:
                      'https://graph.threads.com/keyword_search?limit=5&before=back%2B%2F%3D&access_token=private-api-token',
              }
            : {
                  next: 'https://graph.threads.com/keyword_search?limit=5&after=next%2B%2F%3D&access_token=private-api-token',
                  previous:
                      'https://graph.threads.com/keyword_search?limit=5&before=back%2B%2F%3D&access_token=private-api-token',
              };
        return { data: { data: [], paging } };
    });
    const query = 'café & music + #1';
    const response = await request(
        `/keywordSearch?${new URLSearchParams({
            keyword: query,
            searchType: 'RECENT',
            before: 'old-cursor',
            limit: '5',
            access_token: 'untrusted-request-token',
        })}`
    );
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<option value="RECENT" selected/);
    const next = pagingLink(html, 'Next');
    const previousPosition = html.indexOf('>Previous</a>');
    assert.ok(
        previousPosition >= 0 && previousPosition < html.indexOf('>Next</a>')
    );
    assert.equal(next.pathname, '/keywordSearch');
    assert.equal(next.searchParams.get('keyword'), query);
    assert.equal(next.searchParams.get('searchType'), 'RECENT');
    assert.equal(next.searchParams.get('after'), 'next+/=');
    assert.equal(next.searchParams.has('before'), false);
    assert.equal(next.searchParams.has('access_token'), false);
    assert.doesNotMatch(html, /private-api-token|untrusted-request-token/);

    const nextHtml = await (await request(next)).text();
    assert.equal(calls[1].searchParams.get('q'), query);
    assert.equal(calls[1].searchParams.get('search_type'), 'RECENT');
    assert.equal(calls[1].searchParams.get('after'), 'next+/=');
    assert.equal(calls[1].searchParams.get('limit'), '5');
    assert.equal(calls[1].searchParams.has('before'), false);
    const previous = pagingLink(nextHtml, 'Previous');
    assert.equal(previous.searchParams.get('before'), 'back+/=');
    assert.equal(previous.searchParams.has('after'), false);
    await request(previous);
    assert.equal(calls[2].searchParams.get('before'), 'back+/=');
    assert.equal(calls[2].searchParams.get('q'), query);
});

test('search errors are visible and preserve the form without paging links', async (t) => {
    const request = await startApp(t, async () => {
        throw {
            response: {
                data: { error: { message: 'Search permission is required.' } },
            },
        };
    });
    const html = await (
        await request(
            '/keywordSearch?keyword=music&searchType=RECENT&after=expired'
        )
    ).text();
    assert.match(html, /Search permission is required\./);
    assert.match(html, /<textarea[^>]*>music<\/textarea>/);
    assert.match(html, /<option value="RECENT" selected/);
    assert.doesNotMatch(html, />Next<|>Previous</);
});

test('blank searches and signed-out requests do not call the API', async (t) => {
    const get = () => assert.fail('Unexpected API request');
    const request = await startApp(t, get);
    assert.equal((await request('/keywordSearch')).status, 200);
    const signedOutRequest = await startApp(t, get, false);
    const response = await signedOutRequest(
        '/keywordSearch?keyword=music&after=cursor'
    );
    assert.equal(response.status, 302);
    assert.equal(
        response.headers.get('location'),
        '/?return_url=%2FkeywordSearch%3Fkeyword%3Dmusic%26after%3Dcursor'
    );
});

test('the paging helper still preserves profile usernames and strips stale cursors', async (t) => {
    const request = await startApp(t, async (url) => {
        if (new URL(url).pathname === '/profile_lookup')
            return { data: { name: 'Test Profile' } };
        return {
            data: {
                data: [],
                paging: {
                    next: 'https://graph.threads.com/profile_posts?username=test-profile&limit=10&after=next-cursor&access_token=private-api-token',
                },
            },
        };
    });
    const html = await (
        await request('/profileLookup?username=test-profile&before=old-cursor')
    ).text();
    const next = pagingLink(html, 'Next');
    assert.equal(next.searchParams.get('username'), 'test-profile');
    assert.equal(next.searchParams.get('after'), 'next-cursor');
    assert.equal(next.searchParams.has('before'), false);
    assert.equal(next.searchParams.has('access_token'), false);
});

test('topic tag mode is forwarded and retained across next and previous pages', async (t) => {
    const calls = [];
    const request = await startApp(t, async (url, options) => {
        const apiUrl = new URL(url);
        calls.push(apiUrl);
        assert.ok(options.httpsAgent);
        return {
            data: {
                data: [
                    {
                        id: '123',
                        username: 'test-profile',
                        text: 'Topic Tag Result',
                        media_type: 'TEXT_POST',
                    },
                ],
                paging: apiUrl.searchParams.has('after')
                    ? {
                          previous:
                              'https://graph.threads.com/keyword_search?limit=2&before=back&access_token=private-api-token',
                      }
                    : {
                          next: 'https://graph.threads.com/keyword_search?limit=2&after=next&access_token=private-api-token',
                      },
            },
        };
    });
    const query = 'Música y cine';
    const html = await (
        await request(
            `/keywordSearch?${new URLSearchParams({
                keyword: query,
                searchMode: 'TAG',
                searchType: 'RECENT',
            })}`
        )
    ).text();
    assert.equal(calls[0].searchParams.get('search_mode'), 'TAG');
    assert.equal(calls[0].searchParams.get('q'), query);
    assert.match(html, /<option value="TAG" selected/);
    assert.match(html, /Recent Topic Tag Results/);
    assert.match(html, /Topic Tag Result/);
    const next = pagingLink(html, 'Next');
    assert.equal(next.searchParams.get('searchMode'), 'TAG');
    assert.equal(next.searchParams.get('keyword'), query);
    assert.equal(next.searchParams.has('access_token'), false);
    const nextHtml = await (await request(next)).text();
    assert.equal(calls[1].searchParams.get('search_mode'), 'TAG');
    assert.equal(calls[1].searchParams.get('after'), 'next');
    const previous = pagingLink(nextHtml, 'Previous');
    assert.equal(previous.searchParams.get('searchMode'), 'TAG');
    await request(previous);
    assert.equal(calls[2].searchParams.get('search_mode'), 'TAG');
    assert.equal(calls[2].searchParams.get('before'), 'back');
});

test('keyword mode is the default and invalid modes do not reach the API', async (t) => {
    const calls = [];
    const request = await startApp(t, async (url) => {
        calls.push(new URL(url));
        return { data: { data: [] } };
    });
    for (const route of [
        '/keywordSearch?keyword=music',
        '/keywordSearch?keyword=music&searchMode=KEYWORD',
    ]) {
        const html = await (await request(route)).text();
        assert.match(html, /<option value="KEYWORD" selected/);
        assert.equal(calls.at(-1).searchParams.get('search_mode'), 'KEYWORD');
        assert.equal(calls.at(-1).searchParams.get('search_type'), 'TOP');
    }
    const count = calls.length;
    const response = await request(
        '/keywordSearch?keyword=music&searchMode=INVALID'
    );
    assert.equal(response.status, 400);
    assert.equal(calls.length, count);
    assert.match(await response.text(), /Choose Keyword or Topic Tag/);
});

test('topic tag search errors preserve the mode and render escaped error text', async (t) => {
    const request = await startApp(t, async () => {
        throw {
            response: {
                data: {
                    error: { message: '(#100) Unsupported field <topic_tag>.' },
                },
            },
        };
    });
    const html = await (
        await request(
            '/keywordSearch?keyword=music&searchMode=TAG&searchType=RECENT'
        )
    ).text();
    assert.match(html, /<option value="TAG" selected/);
    assert.match(html, /<option value="RECENT" selected/);
    assert.match(html, /<textarea[^>]*>music<\/textarea>/);
    assert.match(html, /\(#100\) Unsupported field &lt;topic_tag&gt;\./);
    assert.doesNotMatch(html, /Unsupported field <topic_tag>/);
    assert.doesNotMatch(html, />Next<|>Previous</);
});

test('search results request and display the returned topic tag without inventing a missing tag', async (t) => {
    const request = await startApp(t, async (url) => {
        assert.ok(
            new URL(url).searchParams
                .get('fields')
                .split(',')
                .includes('topic_tag')
        );
        return {
            data: {
                data: [
                    {
                        id: '123',
                        username: 'example-author',
                        text: 'Example tagged post',
                        timestamp: '2026-01-02T14:30:00+0200',
                        topic_tag: 'Returned NBA & News',
                        permalink: 'https://example.com/tagged',
                        media_url: 'https://example.com/media',
                    },
                    {
                        id: '456',
                        username: 'example-author',
                        text: 'Example untagged post',
                        timestamp: '<script>invalid timestamp</script>',
                        topic_tag: null,
                        permalink: 'https://example.com/untagged',
                    },
                    {
                        id: '789',
                        username: 'example-author',
                        text: 'Example post with an omitted tag',
                    },
                ],
            },
        };
    });
    const html = await (
        await request('/keywordSearch?keyword=Requested+Topic&searchMode=TAG')
    ).text();
    assert.match(html, /placeholder="Enter a search query…"/);
    const table = html.match(
        /<table class="threads-list">[\s\S]*?<\/table>/
    )[0];
    assert.match(table, /<th scope="col">Topic Tag<\/th>/);
    for (const label of ['Post ID', 'Creation Date and Time', 'Post Link']) {
        assert.ok(table.includes(`<th scope="col">${label}</th>`));
    }
    assert.doesNotMatch(table, /<th[^>]*>(?:ID|Created On|Permalink)<\/th>/);
    assert.match(table, /January 2, 2026 at 12:30 PM UTC/);
    assert.match(table, /&lt;script&gt;invalid timestamp&lt;\/script&gt;/);
    assert.doesNotMatch(table, /<script>invalid timestamp/);
    assert.match(table, /<td class="thread-timestamp"><\/td>/);
    assert.match(table, /Returned NBA &amp; News/);
    assert.equal(
        (table.match(/<td class="thread-topic-tag"><\/td>/g) || []).length,
        2
    );
    assert.doesNotMatch(table, /Not Provided|Requested Topic/);
    assert.match(table, />View Media File<\/a>/);
    assert.match(
        html,
        /role="region" aria-label="Search Results" tabindex="0"/
    );
});

test('date and page-size filters are forwarded and kept in page links', async (t) => {
    const calls = [];
    const request = await startApp(t, async (url) => {
        calls.push(new URL(url));
        return {
            data: {
                data: [],
                paging: {
                    next: 'https://graph.threads.com/keyword_search?after=next&access_token=private-api-token',
                },
            },
        };
    });
    const html = await (
        await request(
            '/keywordSearch?keyword=music&searchMode=TAG&since=2026-01-01&until=2026-01-10&limit=2'
        )
    ).text();
    assert.equal(calls[0].searchParams.get('since'), '2026-01-01');
    assert.equal(calls[0].searchParams.get('until'), '2026-01-10');
    assert.equal(calls[0].searchParams.get('limit'), '2');
    assert.match(html, /name="since" value="2026-01-01"/);
    assert.match(html, /name="until" value="2026-01-10"/);
    const next = pagingLink(html, 'Next');
    assert.equal(next.searchParams.get('since'), '2026-01-01');
    assert.equal(next.searchParams.get('until'), '2026-01-10');
    assert.equal(next.searchParams.get('limit'), '2');
    assert.equal(next.searchParams.has('access_token'), false);
    await request(next);
    assert.equal(calls[1].searchParams.get('since'), '2026-01-01');
    assert.equal(calls[1].searchParams.get('limit'), '2');
    assert.equal(calls[1].searchParams.get('search_mode'), 'TAG');
    assert.equal(calls[1].searchParams.get('after'), 'next');
});

test('blank filters use API defaults, zero is kept, and invalid page sizes make no API call', async (t) => {
    const calls = [];
    const request = await startApp(t, async (url) => {
        calls.push(new URL(url));
        return { data: { data: [] } };
    });
    await request('/keywordSearch?keyword=music&since=&until=&limit=');
    assert.equal(calls[0].searchParams.has('since'), false);
    assert.equal(calls[0].searchParams.has('until'), false);
    assert.equal(calls[0].searchParams.has('limit'), false);
    const zeroHtml = await (
        await request('/keywordSearch?keyword=music&limit=0')
    ).text();
    assert.equal(calls[1].searchParams.get('limit'), '0');
    assert.match(zeroHtml, /name="limit" value="0"/);
    const count = calls.length;
    for (const query of [
        'limit=-1',
        'limit=101',
        'limit=1.5',
        'limit[toString]=bad',
    ]) {
        const response = await request(`/keywordSearch?keyword=music&${query}`);
        assert.equal(response.status, 400);
        assert.equal(calls.length, count);
        assert.match(await response.text(), /whole number from 0 to 100/);
    }
    const malformedDate = await request(
        '/keywordSearch?keyword=music&since[]=a'
    );
    assert.equal(malformedDate.status, 400);
    assert.equal(calls.length, count);
    assert.match(await malformedDate.text(), /Use a date or Unix timestamp/);
});

test('API date errors keep the query and filters without page links', async (t) => {
    const request = await startApp(t, async () => {
        throw {
            response: {
                data: { error: { message: 'Since must be before Until.' } },
            },
        };
    });
    const html = await (
        await request(
            '/keywordSearch?keyword=music&searchMode=TAG&since=2026-01-10&until=2026-01-01&limit=2'
        )
    ).text();
    assert.match(html, /Since must be before Until\./);
    assert.match(html, /name="since" value="2026-01-10"/);
    assert.match(html, /name="until" value="2026-01-01"/);
    assert.match(html, /name="limit" value="2"/);
    assert.match(html, /<option value="TAG" selected/);
    assert.doesNotMatch(html, />Next<|>Previous</);
});

test('API paging date bounds override request dates when supplied', async (t) => {
    const calls = [];
    const request = await startApp(t, async (url) => {
        calls.push(new URL(url));
        return {
            data: {
                data: [],
                paging: {
                    next: 'https://graph.threads.com/keyword_search?limit=2&since=1767225600&until=1767571200',
                },
            },
        };
    });
    const html = await (
        await request(
            '/keywordSearch?keyword=music&since=2026-01-01&until=2026-01-10&limit=5'
        )
    ).text();
    const next = pagingLink(html, 'Next');
    assert.equal(next.searchParams.get('since'), '1767225600');
    assert.equal(next.searchParams.get('until'), '1767571200');
    assert.equal(next.searchParams.get('limit'), '2');
    await request(next);
    assert.equal(calls[1].searchParams.get('since'), '1767225600');
    assert.equal(calls[1].searchParams.get('limit'), '2');
    assert.equal(calls[1].searchParams.get('until'), '1767571200');
});
