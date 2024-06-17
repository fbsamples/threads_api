/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

let loadingOverlay;

document.addEventListener('DOMContentLoaded', () => {
    loadingOverlay = document.getElementById('loadingOverlay');
});

function onAsyncRequestStarting() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'block';
    }
}

function onAsyncRequestEnded() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

async function processFormAsync(urlGenerator) {
    const form = document.getElementById('form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const button = document.getElementById('submit');
        const formData = new FormData(e.target, button);

        onAsyncRequestStarting();

        let id;
        try {
            let response = await fetch(e.target.getAttribute('action'), {
                method: 'POST',
                body: formData
            });

            if(response.ok) {
                let jsonResponse = await response.json();
                id = jsonResponse.id;
            } else {
                resultElem.textContent = 'Error submitting form';
            }
        } catch (error) {
            console.error('There was an error:', error);
            resultElem.textContent = 'Error submitting form';
        } finally {
            onAsyncRequestEnded();
        }

        if (id) {
            window.location.href = urlGenerator(id);
        }
    });
}
