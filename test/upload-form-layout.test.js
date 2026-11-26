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

test('the Upload form preserves submission fields and the dynamic attachment structure', () => {
    const html = pug.renderFile(path.join(__dirname, '../views/upload.pug'), {
        title: 'Upload',
        replyToId: '123',
        quotePostId: '456',
    });
    const form = html.match(
        /<form\b[^>]*action="\/upload"[^>]*id="form"[^>]*method="POST">([\s\S]*?)<\/form>/
    );
    assert.ok(form);
    assert.match(form[1], /To attach an image or video, click the icon below:/);
    assert.match(form[1], /<img id="attachments-button"[^>]*>/);
    assert.match(
        form[1],
        /<div class="attachments" id="attachments-list"><\/div>/
    );
    assert.match(form[1], /id="link-attachment"[^>]*name="linkAttachment"/);
    assert.match(form[1], /id="poll-attachment-options" style="display:none"/);
    assert.match(form[1], /name="replyToId" value="123"/);
    assert.match(form[1], /name="quotePostId" value="456"/);
    assert.match(form[1], /id="submit" value="Post"/);
    assert.match(form[1], /id="media-type"/);
    const mediaTypePosition = form[1].indexOf('id="media-type-explanation"');
    assert.ok(mediaTypePosition > form[1].indexOf('</textarea>'));
    assert.ok(
        mediaTypePosition <
            form[1].indexOf('class="attach-image-media-control"')
    );

    const template = html.match(
        /<script id="attachment-template" type="text\/template">([\s\S]*?)<\/script>/
    );
    assert.ok(template);
    const buttons = template[1].match(
        /<div class="attachment-item"><span class="attachment-number" hidden><\/span>((?:<label\b[^>]*>[\s\S]*?<\/label>)+)<span class="delete"[^>]*>[^<]+<\/span><\/div>$/
    );
    // Upload removes the generated list child by walking up twice from span.delete.
    assert.ok(
        buttons,
        'The remove control is a direct child of the attachment item.'
    );
    const fields = Array.from(
        buttons[1].matchAll(/name="([^"]+)"/g),
        (match) => match[1]
    );
    assert.deepEqual(fields, [
        'attachmentType[]',
        'attachmentUrl[]',
        'attachmentAltText[]',
    ]);
    assert.match(
        buttons[1],
        /<select name="attachmentType\[\]"><option value="Image">Image<\/option><option value="Video">Video<\/option><\/select>/
    );
});

test('the unchanged upload handlers remove rendered clones and restore text attachment controls', async () => {
    const html = pug.renderFile(path.join(__dirname, '../views/upload.pug'), {
        title: 'Upload',
    });
    const templateHTML = html.match(
        /<script id="attachment-template" type="text\/template">([\s\S]*?)<\/script>/
    )[1];
    assert.match(html, /class="poll-attachment-media-control upload-poll"/);
    const element = (tag = 'div', attributes = {}) => ({
        tag,
        attributes,
        children: [],
        parentNode: null,
        events: {},
        style: { display: 'block' },
        disabled: false,
        checked: false,
        value: '',
        hidden: false,
        setAttribute(name, value) {
            this.attributes[name] = value;
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
                if (child.tag !== 'input') stack.push(child);
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
    await clickAttachment();
    const firstClone = list.children[0];
    const firstDelete = firstClone.querySelector('span.delete');
    assert.equal(firstDelete.parentNode.parentNode, firstClone);
    assert.equal(list.children.length, 1);
    assert.equal(fields['media-type'].innerText, 'Image 🖼️');
    assert.equal(
        firstClone.querySelectorAll('.attachment-number')[0].hidden,
        true
    );
    const select = firstClone.querySelector('select');
    select.value = 'Video';
    await select.events.change({ target: select });
    assert.equal(fields['media-type'].innerText, 'Video 🎬');
    await clickAttachment();
    const secondClone = list.children[1];
    assert.equal(fields['media-type'].innerText, 'Carousel 🎠');
    assert.deepEqual(
        list
            .querySelectorAll('.attachment-number')
            .map((label) => [label.textContent, label.hidden]),
        [
            ['Attachment 1', false],
            ['Attachment 2', false],
        ]
    );
    assert.equal(fields['link-attachment'].disabled, true);
    assert.ok(pollInputs.every((input) => input.disabled));
    await firstDelete.events.click({ target: firstDelete });
    assert.equal(firstClone.parentNode, null);
    assert.deepEqual(list.children, [secondClone]);
    assert.equal(
        secondClone.querySelectorAll('.attachment-number')[0].textContent,
        'Attachment 1'
    );
    assert.equal(
        secondClone.querySelectorAll('.attachment-number')[0].hidden,
        true
    );
    assert.equal(fields['media-type'].innerText, 'Image 🖼️');
    const lastDelete = secondClone.querySelector('span.delete');
    await lastDelete.events.click({ target: lastDelete });
    assert.equal(secondClone.parentNode, null);
    assert.equal(list.children.length, 0);
    assert.equal(fields['media-type'].innerText, 'Text 📝');
    assert.equal(fields['link-attachment'].disabled, false);
    assert.equal(
        controls['.poll-attachment-media-control'].style.display,
        'block'
    );
    assert.ok(pollInputs.every((input) => !input.disabled));
    assert.equal(
        fields['link-attachment'].value,
        'https://example.invalid/draft'
    );
    assert.deepEqual(
        pollInputs.map((input) => input.value),
        ['A', 'B', 'C', 'D']
    );
});
