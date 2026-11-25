/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

let refreshing = false;
let wasHidden = document.hidden;

function refreshCounts() {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
}

window.addEventListener('pagehide', () => {
    refreshing = false;
});

window.addEventListener('pageshow', (event) => {
    if (event.persisted) refreshCounts();
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        wasHidden = true;
    } else if (wasHidden) {
        refreshCounts();
    }
});
