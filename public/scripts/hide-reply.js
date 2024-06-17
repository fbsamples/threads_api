/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const hideForms = document.getElementsByClassName('hide-reply');
    for (let i = 0; i < hideForms.length; i++) {
        const hideForm = hideForms[i];
        hideForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            onAsyncRequestStarting();

            const formData = new FormData(e.target);
            try {
                let response = await fetch(e.target.getAttribute('action'), {
                    method: 'POST',
                    body: formData
                });

                if(response.ok) {
                    const submitButton = e.target.querySelector('input[type="submit"]');
                    submitButton.value = submitButton.value === 'Hide' ? 'Unhide' : 'Hide';
                } else {
                    alert('An error occurred while hiding/unhiding the reply.');
                }
            } catch (e) {
                console.error('There was an error:', error);
                alert('error while hiding reply')
            } finally {
                onAsyncRequestEnded();
            }
        });
    }
});
