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

test('the attachment cap blocks a twenty-first clone and re-enables adding after removal', async () => {
    const html = pug.renderFile(path.join(__dirname, '../views/upload.pug'), {
        title: 'Upload',
    });
    const templateHTML = html.match(
        /<script id="attachment-template" type="text\/template">([\s\S]*?)<\/script>/
    )[1];
    const element = (tag = 'div', attributes = {}) => ({
        tag,
        attributes,
        children: [],
        parentNode: null,
        events: {},
        style: { display: 'block' },
        disabled: false,
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        checked: false,
        value: '',
        addEventListener(name, handler) {
            this.events[name] = handler;
        },
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
        },
        remove() {
            const siblings = this.parentNode.children;
            siblings.splice(siblings.indexOf(this), 1);
            this.parentNode = null;
        },
        querySelector(selector) {
            const [wantedTag, wantedClass] = selector.split('.');
            for (const child of this.children) {
                if (
                    child.tag === wantedTag &&
                    (!wantedClass ||
                        child.attributes.class
                            ?.split(' ')
                            .includes(wantedClass))
                )
                    return child;
                const found = child.querySelector(selector);
                if (found) return found;
            }
        },
        querySelectorAll(selector) {
            const found = [];
            const collect = (node) => {
                for (const child of node.children) {
                    if (
                        selector === '.attachment-number' &&
                        child.attributes.class === 'attachment-number'
                    )
                        found.push(child);
                    collect(child);
                }
            };
            collect(this);
            return found;
        },
        set innerHTML(markup) {
            this.children = [];
            const stack = [this];
            // Parse only the controlled rendered attachment fixture, without executing HTML.
            for (const match of markup.matchAll(/<\/?([a-z]+)([^>]*)>/g)) {
                if (match[0].startsWith('</')) {
                    assert.equal(stack.pop().tag, match[1]);
                    continue;
                }
                const attrs = Object.fromEntries(
                    [...match[2].matchAll(/([a-z]+)="([^"]*)"/g)].map(
                        (attr) => [attr[1], attr[2]]
                    )
                );
                const child = element(match[1], attrs);
                stack.at(-1).appendChild(child);
                if (child.tag === 'select') child.value = 'Image';
                if (!['input', 'br', 'img'].includes(child.tag))
                    stack.push(child);
            }
            assert.equal(stack.length, 1);
        },
    });
    const fields = Object.fromEntries(
        [
            'media-type',
            'link-attachment',
            'poll-attachment-button',
            'poll-attachment-options',
            'attachments-list',
            'attachments-button',
            'topic-tag',
            'reply-control',
        ].map((name) => [name, element()])
    );
    fields['attachment-template'] = { textContent: templateHTML };
    fields['link-attachment'].value = 'https://example.invalid/draft';
    fields['poll-attachment-options'].style.display = 'none';
    const pollInputs = ['A', 'B', 'C', 'D'].map((value) => ({
        ...element('input'),
        value,
    }));
    fields['poll-attachment-options'].querySelectorAll = () => pollInputs;
    const ghost = element('input');
    const controls = Object.fromEntries(
        [
            '.link-attachment-media-control',
            '.poll-attachment-media-control',
            '.ghost-post-media-control',
            '.spoiler-media-control',
            '.auto-publish-text-media-control',
            '.topic-tag-media-control',
            '.attach-image-media-control',
            '.reply-options-media-control',
        ].map((name) => [name, element()])
    );
    controls['input[name="ghostPostMedia"]'] = ghost;
    controls['.poll-attachment-media-control'].querySelectorAll = () => [
        ...pollInputs,
        fields['poll-attachment-button'],
    ];
    let ready;
    vm.runInNewContext(
        fs.readFileSync(
            path.join(__dirname, '../public/scripts/upload.js'),
            'utf8'
        ),
        {
            document: {
                getElementById: (id) => fields[id],
                querySelector: (selector) => controls[selector],
                createElement: element,
                addEventListener: (_event, handler) => {
                    ready = handler;
                },
            },
            processFormAsync: async () => {},
        },
        { timeout: 3000 }
    );
    await ready();
    const list = fields['attachments-list'];
    const clickAttachment = () =>
        fields['attachments-button'].events.click({ preventDefault() {} });
    assert.equal(
        fields['attachments-button'].attributes['aria-disabled'],
        'false'
    );
    for (let index = 0; index < 20; index++) {
        await clickAttachment();
        if (index % 2) {
            const select = list.children.at(-1).querySelector('select');
            select.value = 'Video';
            await select.events.change({ target: select });
        }
    }
    assert.equal(list.children.length, 20);
    assert.deepEqual(
        list
            .querySelectorAll('.attachment-number')
            .map((label) => [label.textContent, label.hidden]),
        Array.from({ length: 20 }, (_, index) => [
            `Attachment ${index + 1}`,
            false,
        ])
    );
    assert.equal(fields['media-type'].innerText, 'Carousel 🎠');
    assert.equal(
        fields['attachments-button'].attributes['aria-disabled'],
        'true'
    );
    assert.equal(fields['attachments-button'].style.cursor, 'not-allowed');
    assert.equal(fields['link-attachment'].disabled, true);
    assert.ok(pollInputs.every((input) => input.disabled));
    assert.equal(
        list.children.filter(
            (clone) => clone.querySelector('select').value === 'Video'
        ).length,
        10
    );
    await clickAttachment();
    assert.equal(list.children.length, 20);
    const removed = list.children[0];
    const removeControl = removed.querySelector('span.delete');
    assert.equal(removeControl.parentNode.parentNode, removed);
    await removeControl.events.click({ target: removeControl });
    assert.equal(removed.parentNode, null);
    assert.equal(list.children.length, 19);
    assert.deepEqual(
        list
            .querySelectorAll('.attachment-number')
            .map((label) => label.textContent),
        Array.from({ length: 19 }, (_, index) => `Attachment ${index + 1}`)
    );
    assert.equal(
        fields['attachments-button'].attributes['aria-disabled'],
        'false'
    );
    assert.equal(fields['attachments-button'].style.cursor, 'pointer');
    await clickAttachment();
    assert.equal(list.children.length, 20);
    for (const clone of [...list.children]) {
        const remove = clone.querySelector('span.delete');
        await remove.events.click({ target: remove });
    }
    assert.equal(list.children.length, 0);
    assert.equal(fields['media-type'].innerText, 'Text 📝');
    assert.equal(
        fields['attachments-button'].attributes['aria-disabled'],
        'false'
    );
    assert.equal(fields['link-attachment'].disabled, false);
    assert.ok(pollInputs.every((input) => !input.disabled));
    assert.equal(
        fields['link-attachment'].value,
        'https://example.invalid/draft'
    );
    ghost.checked = true;
    await ghost.events.change();
    assert.equal(fields['link-attachment'].disabled, true);
    assert.equal(
        controls['.poll-attachment-media-control'].style.display,
        'none'
    );
    ghost.checked = false;
    await ghost.events.change();
    assert.equal(fields['link-attachment'].disabled, false);
});
