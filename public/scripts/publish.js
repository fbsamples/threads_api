/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

const QUERYING_STATUS_TEXT = '...';
const QUERY_CONTAINER_STATUS_TIMEOUT_IN_SECONDS = 5;

document.addEventListener('DOMContentLoaded', async () => {
    await processFormAsync((id) => `/threads/${id}`);

    queryContainerStatus();
});

async function queryContainerStatus() {
    const containerId = document.getElementById('container-id').getAttribute('value');

    const statusDOMElement = document.getElementById('container-status');
    statusDOMElement.innerText = QUERYING_STATUS_TEXT;

    onAsyncRequestStarting();

    let jsonResponse;
    try {
        let response = await fetch(`/container/status/${containerId}`);

        if(response?.ok) {
            jsonResponse = await response.json();
        } else {
            console.error(response);
        }
    } catch (e) {
        console.error(e);
    } finally {
        onAsyncRequestEnded();
    }

    switch (jsonResponse?.status) {
        case 'FINISHED':
            // Enable publishing
            document.getElementById('submit').removeAttribute('disabled');
            break;
        case 'IN_PROGRESS':
            // Retry
            setTimeout(queryContainerStatus, QUERY_CONTAINER_STATUS_TIMEOUT_IN_SECONDS * 1000);
            break;
        case 'ERROR':
        default:
            document.getElementById('error-message').textContent = jsonResponse?.error_message ?? "Unknown error";
            break;
    }

    updateView(statusDOMElement, jsonResponse?.status);
}

function updateView(statusDOMElement, status) {
    statusDOMElement.innerText = status;

    const explanationTemplate = document.getElementById(`template-status-${status}`);
    if (explanationTemplate) {
        const explanationParentDOMElement = document.getElementById('status-explanation');
        if (explanationParentDOMElement) {
            const explanationNode = explanationTemplate.content.cloneNode(true);
            explanationParentDOMElement.replaceChildren(explanationNode);
        }
    }
}
