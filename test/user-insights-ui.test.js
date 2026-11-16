/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const pug = require('pug');

const views = path.join(__dirname, '../views');
const metrics = [
    {
        name: '<b>Example Metric</b>',
        value: 0,
        description: '<script>Example description</script>',
        id: '<i>example-metric-id</i>',
    },
];

test('user insights preserves zero values, escaped metrics and date-filter semantics', () => {
    const html = pug.renderFile(path.join(views, 'user_insights.pug'), {
        title: 'User Insights',
        metrics,
        since: '2026-01-01',
        until: '2026-01-31',
    });
    assert.match(html, /<th scope="col">ID<\/th>/);
    assert.doesNotMatch(
        html,
        /<th[^>]*>Id<\/th>|<script>Example description|<b>Example Metric|<i>example-metric-id/
    );
    assert.match(html, /<td>0<\/td>/);
    assert.match(html, /&lt;script&gt;Example description&lt;\/script&gt;/);
    assert.match(html, /&lt;b&gt;Example Metric&lt;\/b&gt;/);
    assert.match(html, /&lt;i&gt;example-metric-id&lt;\/i&gt;/);
    assert.match(html, /action="\/userInsights" method="GET"/);
    for (const [id, value] of [
        ['since', '2026-01-01'],
        ['until', '2026-01-31'],
    ]) {
        assert.ok(html.includes(`for="${id}"`));
        assert.ok(
            html.includes(
                `id="${id}" type="date" name="${id}" value="${value}"`
            )
        );
    }
    assert.match(
        html,
        /name="viewport" content="width=device-width, initial-scale=1"/
    );
    assert.match(
        html,
        /role="region" aria-label="User Insights Metrics" tabindex="0"/
    );
});

test('empty user insights and the shared media table retain values and navigation without user styles', () => {
    const user = pug.renderFile(path.join(views, 'user_insights.pug'), {
        title: 'User Insights',
        metrics: [],
    });
    assert.match(user, /value="Refine"/);
    assert.doesNotMatch(user, /undefined/);
    const media = pug.renderFile(path.join(views, 'thread_insights.pug'), {
        title: 'Media Insights',
        threadId: '123',
        metrics,
    });
    assert.match(media, /<th scope="col">ID<\/th>/);
    assert.match(media, /<td>0<\/td>/);
    assert.match(media, /&lt;b&gt;Example Metric&lt;\/b&gt;/);
    assert.match(media, /action="\/threads\/123\/insights" method="GET"/);
    assert.doesNotMatch(media, /class="user-insights"|name="viewport"/);
    const css = fs.readFileSync(
        path.join(__dirname, '../public/css/style.css'),
        'utf8'
    );
    assert.ok(css.includes('.user-insights {'));
    const rules = css.slice(css.indexOf('.user-insights {'));
    assert.ok(rules.length > 0);
    for (const selector of rules.matchAll(/([^{}]+)\{/g)) {
        const value = selector[1].trim();
        assert.ok(
            value.startsWith('@media') ||
                value
                    .split(',')
                    .every((part) => part.trim().startsWith('.user-insights'))
        );
    }
});
