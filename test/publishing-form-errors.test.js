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

const fallback = 'Unable to submit the form. Reload the page and try again.';

test('publishing forms display server error messages, safely fall back, and keep success behavior', async () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../public/scripts/form.js'),
        'utf8'
    );
    for (const scenario of [
        {
            payload: {
                message:
                    'Too many publishing requests. Wait a minute and try again.',
            },
            expected:
                'Too many publishing requests. Wait a minute and try again.',
        },
        {
            payload: { message: '<script>Example error</script>' },
            expected: '<script>Example error</script>',
        },
        { payload: { message: '' }, expected: fallback },
        { payload: { message: '   ' }, expected: fallback },
        { payload: { message: { text: 'Not a string.' } }, expected: fallback },
        { payload: null, expected: fallback },
        { invalidJson: true, expected: fallback },
        { ok: true, payload: { id: '123' }, destination: '/threads/123' },
        {
            ok: true,
            payload: { redirectUrl: '/threads/456' },
            destination: '/threads/456',
        },
    ]) {
        let submit;
        let calls = 0;
        const alerts = [];
        const overlay = { style: { display: 'none' } };
        const form = {
            addEventListener(name, callback) {
                assert.equal(name, 'submit');
                submit = callback;
            },
            getAttribute(name) {
                assert.equal(name, 'action');
                return '/publish';
            },
        };
        const window = { location: { href: '' } };
        const Form = class extends FormData {
            constructor() {
                super();
            }
        };
        const context = vm.createContext({
            window,
            FormData: Form,
            document: {
                addEventListener(name, callback) {
                    assert.equal(name, 'DOMContentLoaded');
                    callback();
                },
                getElementById(id) {
                    return id === 'form'
                        ? form
                        : id === 'loadingOverlay'
                        ? overlay
                        : {};
                },
                querySelector(selector) {
                    assert.equal(selector, 'meta[name="csrf-token"]');
                    return { content: 'synthetic-csrf-token' };
                },
            },
            alert(value) {
                alerts.push(value);
            },
            console: { error() {} },
            async fetch(url, options) {
                calls++;
                assert.equal(url, '/publish');
                assert.equal(options.method, 'POST');
                assert.equal(options.mode, 'same-origin');
                assert.equal(
                    options.headers['X-CSRF-Token'],
                    'synthetic-csrf-token'
                );
                assert.ok(options.body instanceof Form);
                return {
                    ok: scenario.ok === true,
                    async json() {
                        if (scenario.invalidJson)
                            throw new SyntaxError(
                                'Synthetic non-JSON error response.'
                            );
                        return scenario.payload;
                    },
                };
            },
        });
        await vm.runInContext(
            source + '\nprocessFormAsync(id => `/threads/${id}`);',
            context
        );
        assert.equal(typeof submit, 'function');
        let prevented = false;
        await submit({
            target: form,
            preventDefault() {
                prevented = true;
            },
        });
        assert.ok(prevented);
        assert.equal(calls, 1);
        assert.equal(overlay.style.display, 'none');
        if (scenario.ok) {
            assert.deepEqual(alerts, []);
            assert.equal(window.location.href, scenario.destination);
        } else {
            assert.deepEqual(alerts, [scenario.expected]);
            assert.equal(window.location.href, '');
        }
    }
});
