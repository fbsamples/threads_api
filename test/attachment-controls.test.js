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
const pug = require('pug');

test('media hides and disables text attachments, restores drafts, and preserves ghost exclusions', async () => {
    const element = (value = '') => ({
        value,
        checked: false,
        disabled: false,
        style: { display: 'block' },
        events: {},
        addEventListener(name, callback) {
            this.events[name] = callback;
        },
    });
    const link = element('https://example.invalid/draft');
    const pollInputs = ['A', 'B', 'C', 'D'].map(element);
    const pollButton = element();
    const pollOptions = element();
    pollOptions.style.display = 'none';
    pollOptions.querySelectorAll = () => pollInputs;
    const pollControl = element();
    pollControl.querySelectorAll = () => [...pollInputs, pollButton];
    const ghost = element();
    const linkControl = element();
    const mediaType = element();
    const attachments = element();
    attachments.children = [];
    attachments.querySelector = () => ({ value: 'Image' });
    const controls = {
        '.link-attachment-media-control': linkControl,
        '.poll-attachment-media-control': pollControl,
        'input[name="ghostPostMedia"]': ghost,
        '.ghost-post-media-control': element(),
        '.spoiler-media-control': element(),
        '.auto-publish-text-media-control': element(),
        '.topic-tag-media-control': element(),
        '.attach-image-media-control': element(),
        '.reply-options-media-control': element(),
    };
    const fields = {
        'media-type': mediaType,
        'link-attachment': link,
        'poll-attachment-button': pollButton,
        'poll-attachment-options': pollOptions,
        'attachments-list': attachments,
        'attachments-button': element(),
        'topic-tag': element(),
        'reply-control': element(),
    };
    let ready;
    const update = vm.runInNewContext(
        fs.readFileSync(
            path.join(__dirname, '../public/scripts/upload.js'),
            'utf8'
        ) + '\nupdateMediaType;',
        {
            document: {
                getElementById: (id) => fields[id],
                querySelector: (selector) => controls[selector],
                addEventListener: (_name, callback) => {
                    ready = callback;
                },
            },
            processFormAsync: async () => {},
        },
        { timeout: 3000 }
    );
    await ready();
    const assertTextAttachments = (enabled) => {
        assert.equal(linkControl.style.display, enabled ? 'block' : 'none');
        assert.equal(pollControl.style.display, enabled ? 'block' : 'none');
        assert.equal(link.disabled, !enabled);
        for (const input of [...pollInputs, pollButton])
            assert.equal(input.disabled, !enabled);
    };
    assertTextAttachments(true);
    await pollButton.events.click({ preventDefault() {} });
    assert.equal(pollOptions.style.display, 'block');
    assert.equal(pollButton.textContent, 'Remove Poll 🗳️');
    await pollButton.events.click({ preventDefault() {} });
    assert.equal(pollOptions.style.display, 'none');
    assert.equal(pollButton.textContent, 'Attach Poll 🗳️');
    assert.deepEqual(
        pollInputs.map((input) => input.value),
        ['', '', '', '']
    );
    pollInputs.forEach((input, index) => {
        input.value = ['A', 'B', 'C', 'D'][index];
    });
    await pollButton.events.click({ preventDefault() {} });
    assert.equal(pollOptions.style.display, 'block');
    assert.equal(pollButton.textContent, 'Remove Poll 🗳️');
    for (const [count, type, label] of [
        [1, 'Image', 'Image 🖼️'],
        [1, 'Video', 'Video 🎬'],
        [2, 'Image', 'Carousel 🎠'],
    ]) {
        attachments.children = Array.from({ length: count }, () => element());
        attachments.querySelector = () => ({ value: type });
        await update(count, attachments);
        assert.equal(mediaType.innerText, label);
        assertTextAttachments(false);
        assert.equal(link.value, 'https://example.invalid/draft');
        assert.deepEqual(
            pollInputs.map((input) => input.value),
            ['A', 'B', 'C', 'D']
        );
    }
    await update(1, attachments);
    assertTextAttachments(false);
    attachments.children = [];
    await update(0, attachments);
    assertTextAttachments(true);
    assert.equal(pollOptions.style.display, 'block');
    assert.equal(controls['.ghost-post-media-control'].style.display, 'none');
    ghost.checked = true;
    await ghost.events.change();
    assertTextAttachments(false);
    assert.equal(link.value, '');
    assert.deepEqual(
        pollInputs.map((input) => input.value),
        ['', '', '', '']
    );
    assert.equal(pollOptions.style.display, 'none');
    assert.equal(pollButton.textContent, 'Attach Poll 🗳️');
    ghost.checked = false;
    await ghost.events.change();
    assertTextAttachments(true);

    const html = pug.renderFile(path.join(__dirname, '../views/upload.pug'), {
        title: 'Upload',
    });
    assert.match(
        html,
        /<div class="poll-attachment-media-control(?: [^"]+)?"><button id="poll-attachment-button"/
    );
    for (const field of [
        'linkAttachment',
        'pollOptionA',
        'pollOptionB',
        'pollOptionC',
        'pollOptionD',
    ]) {
        assert.ok(html.includes(`name="${field}"`));
    }
});
