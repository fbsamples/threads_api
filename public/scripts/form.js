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

function isPollInputValid(data) {
    const pollOptionA = data.get('pollOptionA');
    const pollOptionB = data.get('pollOptionB');
    const pollOptionC = data.get('pollOptionC');
    const pollOptionD = data.get('pollOptionD');
    const pollAttached =
        pollOptionA || pollOptionB || pollOptionC || pollOptionD;

    if (pollAttached && (!pollOptionA || !pollOptionB)) {
        alert('Options A and B are required for polls.');
        return false;
    }

    if (pollOptionD && !pollOptionC) {
        alert('Option D cannot be used without option C.');
        return false;
    }

    return true;
}

function isAttachmentsInputValid(data) {
    const pollAttached =
        data.get('pollOptionA') ||
        data.get('pollOptionB') ||
        data.get('pollOptionC') ||
        data.get('pollOptionD');
    const linkAttached = data.get('linkAttachment');
    const hasMediaAttachment = data.has('attachmentType[]');
    const autoPublishText = data.get('autoPublishText');

    if (pollAttached && linkAttached) {
        alert('Link attachments and poll attachments cannot be used together.');
        return false;
    }

    if (hasMediaAttachment && autoPublishText) {
        alert('Media attachments cannot be automatically published.');
        return false;
    }

    if (hasMediaAttachment && linkAttached) {
        alert('Link attachments can only be used with text posts.');
        return false;
    }

    if (hasMediaAttachment && pollAttached) {
        alert('Poll attachments can only be used with text posts.');
        return false;
    }

    return true;
}

function isFormDataValid(data) {
    if (!isPollInputValid(data) || !isAttachmentsInputValid(data)) {
        return false;
    }

    return true;
}

async function processFormAsync(urlGenerator) {
    const form = document.getElementById('form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const button = document.getElementById('submit');
        const formData = new FormData(e.target, button);

        if (!isFormDataValid(formData)) {
            return;
        }

        onAsyncRequestStarting();

        let id;
        let redirectUrl;
        try {
            let response = await fetch(e.target.getAttribute('action'), {
                method: 'POST',
                mode: 'same-origin',
                headers: {
                    'X-CSRF-Token':
                        document.querySelector('meta[name="csrf-token"]')
                            ?.content ?? '',
                },
                body: formData,
            });

            if (response.ok) {
                let jsonResponse = await response.json();
                id = jsonResponse.id;
                redirectUrl = jsonResponse.redirectUrl;
            } else {
                const fallback =
                    'Unable to submit the form. Reload the page and try again.';
                let message = fallback;
                try {
                    const errorResponse = await response.json();
                    if (
                        typeof errorResponse?.message === 'string' &&
                        errorResponse.message.trim()
                    ) {
                        message = errorResponse.message;
                    }
                } catch {
                    // Non-JSON error responses use the generic message.
                }
                alert(message);
            }
        } catch (error) {
            console.error('There was an error:', error);
            alert('Unable to submit the form.');
        } finally {
            onAsyncRequestEnded();
        }

        if (id) {
            window.location.href = urlGenerator(id);
        } else if (redirectUrl) {
            window.location.href = redirectUrl;
        }
    });
}
