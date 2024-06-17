/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

async function updateMediaType(attachmentsCount, attachmentListElem) {
    const mediaTypeElem = document.getElementById('media-type');

    let mediaTypeDesc;
    if (attachmentsCount === 0) {
        mediaTypeDesc = 'Text 📝';
    }
    else if (attachmentsCount === 1) {
        const singleAttachmentType = attachmentListElem.querySelector('select').value;
        if (singleAttachmentType === 'Image')
            mediaTypeDesc = 'Image 🖼️';
        else
            mediaTypeDesc = 'Video 🎬';
    }
    else {
        mediaTypeDesc = 'Carousel 🎠';
    }

    mediaTypeElem.innerText = mediaTypeDesc;
}

document.addEventListener('DOMContentLoaded', async () => {
    await processFormAsync((id) => `/publish/${id}`);

    const attachmentsButton = document.getElementById('attachments-button');
    attachmentsButton.addEventListener('click', async (e) => {
        e.preventDefault();

        const attachmentsList = document.getElementById('attachments-list');
        const template = document.getElementById('attachment-template');

        const div = document.createElement('div');
        div.innerHTML = template.textContent;
        attachmentsList.appendChild(div);

        const deleteElem = div.querySelector('span.delete');
        deleteElem.addEventListener('click', async (e) => {
            const parentDiv = e.target.parentNode.parentNode;
            parentDiv.remove();

            await updateMediaType(attachmentsList.children.length, attachmentsList);
        });

        const mediaTypeSelectElem = div.querySelector('select');
        mediaTypeSelectElem.addEventListener('change', async (e) => {
            await updateMediaType(attachmentsList.children.length, attachmentsList);
        });

        await updateMediaType(attachmentsList.children.length, attachmentsList);
    });

    await updateMediaType(0, null);
});
