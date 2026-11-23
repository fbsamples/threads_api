/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

document.addEventListener('DOMContentLoaded', () => {
    const formatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'long',
        timeStyle: 'long',
    });
    for (const element of document.querySelectorAll(
        'time[data-local-timestamp]'
    )) {
        const date = new Date(element.dateTime);
        if (Number.isFinite(date.getTime())) {
            element.textContent = formatter.format(date);
        }
    }
});
