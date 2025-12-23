/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

async function updateMediaType(attachmentsCount, attachmentListElem) {
    const mediaTypeElem = document.getElementById('media-type');
    const spoilerMediaControl = document.querySelector('.spoiler-media-control');
    const ghostPostMediaControl = document.querySelector('.ghost-post-media-control');

    let mediaTypeDesc;
    if (attachmentsCount === 0) {
        mediaTypeDesc = 'Text 📝';
        spoilerMediaControl.style.display = 'none';
        ghostPostMediaControl.style.display = 'block';
    } else if (attachmentsCount === 1) {
        const singleAttachmentType =
            attachmentListElem.querySelector('select').value;
        if (singleAttachmentType === 'Image') mediaTypeDesc = 'Image 🖼️';
        else mediaTypeDesc = 'Video 🎬';
        spoilerMediaControl.style.display = 'block';
        ghostPostMediaControl.style.display = 'none';
    } else {
        mediaTypeDesc = 'Carousel 🎠';
        spoilerMediaControl.style.display = 'block';
        ghostPostMediaControl.style.display = 'none';
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

            await updateMediaType(
                attachmentsList.children.length,
                attachmentsList
            );
        });

        const mediaTypeSelectElem = div.querySelector('select');
        mediaTypeSelectElem.addEventListener('change', async (e) => {
            await updateMediaType(
                attachmentsList.children.length,
                attachmentsList
            );
        });

        await updateMediaType(attachmentsList.children.length, attachmentsList);
    });

    await updateMediaType(0, null);

    const attachPollButton = document.getElementById('poll-attachment-button');
    attachPollButton.addEventListener('click', async (e) => {
        e.preventDefault();

        const pollAttachmentOptions = document.getElementById(
            'poll-attachment-options'
        );
        const ghostPostMediaControl = document.querySelector('.ghost-post-media-control');
        if (pollAttachmentOptions.style.display === 'none') {
            pollAttachmentOptions.style.display = 'block';
            ghostPostMediaControl.style.display = 'none';
        } else {
            pollAttachmentOptions.style.display = 'none';
            ghostPostMediaControl.style.display = 'block';
        }
    });

    const ghostPostCheckbox = document.querySelector('input[name="ghostPostMedia"]');
    const topicTagMediaControl = document.querySelector('.topic-tag-media-control');
    const linkAttachmentMediaControl = document.querySelector('.link-attachment-media-control');
    const attachImageMediaControl = document.querySelector('.attach-image-media-control');
    const replyMediaControl = document.querySelector('.reply-options-media-control');

    const topicTagInput = document.getElementById('topic-tag');
    const linkAttachmentInput = document.getElementById('link-attachment');
    const replyControlSelect = document.getElementById('reply-control');
    const attachmentsList = document.getElementById('attachments-list');
    const pollAttachmentOptions = document.getElementById('poll-attachment-options');

    if (ghostPostCheckbox) {
        ghostPostCheckbox.addEventListener('change', async () => {
            // When ghost post is checked, disable fields that are not relevant to ghost posts
            if (ghostPostCheckbox.checked) {
                topicTagMediaControl.style.display = 'none';
                linkAttachmentMediaControl.style.display = 'none';
                attachPollButton.style.display = 'none';
                attachImageMediaControl.style.display = 'none';
                replyMediaControl.style.display = 'none';

                if (topicTagInput) topicTagInput.value = '';
                if (linkAttachmentInput) linkAttachmentInput.value = '';
                if (replyControlSelect) replyControlSelect.value = '';
                if (attachmentsList) attachmentsList.innerHTML = '';
                if (pollAttachmentOptions) {
                    pollAttachmentOptions.style.display = 'none';
                    const pollInputs = pollAttachmentOptions.querySelectorAll('input[type="text"]');
                    pollInputs.forEach(input => input.value = '');
                }

                await updateMediaType(0, null);
            }
            // When the checkbox is unchecked, enable all fields
            if (!ghostPostCheckbox.checked) {
                topicTagMediaControl.style.display = 'block';
                linkAttachmentMediaControl.style.display = 'block';
                attachPollButton.style.display = 'block';
                attachImageMediaControl.style.display = 'block';
                replyMediaControl.style.display = 'block';
            }
        });
    }
});
