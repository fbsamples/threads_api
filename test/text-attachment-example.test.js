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

const collection = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, '../postman/threads-api.postman_collection.json'),
        'utf8'
    )
);

test('the optional text attachment example is valid JSON with its original styling', () => {
    const items = [...collection.item];
    let parameter;
    while (items.length) {
        const item = items.shift();
        items.push(...(item.item ?? []));
        if (item.name === '1.1 Create Text Container') {
            parameter = item.request.url.query.find(
                ({ key }) => key === 'text_attachment'
            );
            break;
        }
    }
    assert.ok(parameter, 'The existing text attachment example is present.');
    assert.equal(parameter.disabled, true);
    const attachment = JSON.parse(parameter.value);
    assert.deepEqual(attachment, {
        plaintext: 'this is a text attachment',
        link_attachment_url: 'https://meta.com',
        text_with_styling_info: [
            { offset: 10, length: 4, styling_info: ['bold', 'italic'] },
        ],
    });
    let previousEnd = 0;
    for (const range of attachment.text_with_styling_info) {
        assert.ok(range.offset >= previousEnd);
        assert.ok(range.length > 0);
        previousEnd = range.offset + range.length;
        assert.ok(previousEnd <= attachment.plaintext.length);
    }
});
