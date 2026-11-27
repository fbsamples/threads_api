/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('timestamps use the viewer locale and timezone, including date boundaries and daylight saving', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../public/scripts/local-timestamps.js'),
        'utf8'
    );
    const instants = [
        '2026-11-17T01:15:00.000Z',
        '2026-03-08T06:59:00.000Z',
        '2026-03-08T07:01:00.000Z',
        '1970-01-01T00:00:00.000Z',
    ];
    const outputs = new Map();
    for (const [locale, zone] of [
        ['en-US', 'America/New_York'],
        ['en-US', 'Asia/Kolkata'],
        ['fr-FR', 'Europe/Paris'],
    ]) {
        const elements = [...instants, '', 'invalid'].map((dateTime) => ({
            dateTime,
            textContent: 'Readable server fallback',
        }));
        let ready;
        vm.runInNewContext(source, {
            Date,
            Intl: {
                DateTimeFormat: class {
                    constructor(requestedLocale, options) {
                        assert.equal(
                            requestedLocale,
                            undefined,
                            'The browser chooses the locale.'
                        );
                        assert.equal(
                            options.timeZone,
                            undefined,
                            'The browser chooses the timezone.'
                        );
                        assert.equal(
                            options.timeStyle,
                            'long',
                            'The local time includes its timezone label.'
                        );
                        this.formatter = new Intl.DateTimeFormat(locale, {
                            ...options,
                            timeZone: zone,
                        });
                    }
                    format(date) {
                        return this.formatter.format(date);
                    }
                },
            },
            document: {
                addEventListener(event, callback) {
                    assert.equal(event, 'DOMContentLoaded');
                    ready = callback;
                },
                querySelectorAll(selector) {
                    assert.equal(selector, 'time[data-local-timestamp]');
                    return elements;
                },
            },
        });
        assert.ok(
            elements.every(
                (element) => element.textContent === 'Readable server fallback'
            ),
            'Before JavaScript runs the fallback remains visible.'
        );
        ready();
        const expected = new Intl.DateTimeFormat(locale, {
            dateStyle: 'long',
            timeStyle: 'long',
            timeZone: zone,
        });
        for (let i = 0; i < instants.length; i++) {
            assert.equal(
                elements[i].textContent,
                expected.format(new Date(instants[i]))
            );
            assert.equal(
                elements[i].dateTime,
                instants[i],
                'Formatting does not change the represented instant.'
            );
        }
        assert.equal(elements.at(-1).textContent, 'Readable server fallback');
        assert.equal(elements.at(-2).textContent, 'Readable server fallback');
        outputs.set(
            zone,
            elements.map((element) => element.textContent)
        );
    }
    assert.match(outputs.get('America/New_York')[0], /November 16, 2026/);
    assert.match(outputs.get('Asia/Kolkata')[0], /November 17, 2026/);
    assert.match(outputs.get('America/New_York')[1], /1:59:00 AM EST/);
    assert.match(outputs.get('America/New_York')[2], /3:01:00 AM EDT/);
    assert.match(outputs.get('America/New_York')[3], /December 31, 1969/);
});
