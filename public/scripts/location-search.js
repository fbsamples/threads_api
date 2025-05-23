/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

function handleLocationResultButtonClick (id, name) {
    const locationTagId = document.getElementById('location-tag-id');
    const locationTagName = document.getElementById('location-tag-name');

    locationTagId.value = id;
    locationTagName.value = name;
}

function handleClearLocationButtonClick () {
    const locationTagId = document.getElementById('location-tag-id');
    const locationTagName = document.getElementById('location-tag-name');

    locationTagId.value = '';
    locationTagName.value = '';
}

async function processLocationSearchFormAsync() {
    const searchButton = document.getElementById('search-locations');

    const form = document.getElementById('location-search-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const button = document.getElementById('search-locations');
        const formData = new FormData(e.target, button);

        try {
            searchButton.disabled = true;

            let response = await fetch(e.target.getAttribute('action'), {
                method: 'POST',
                body: formData
            });

            if(response.ok) {
                let locations = await response.json();
                const locationSearchResults = document.getElementById('location-search-results');
                for (const location of locations) {
                    const locationSearchResult = document.createElement('tr');

                    const locationSearchResultName = document.createElement('div');
                    locationSearchResultName.innerHTML = location.name;
                    locationSearchResultName.classList.add('location-search-result');

                    const locationSearchResultButton = document.createElement('input');
                    locationSearchResultButton.setAttribute('type', 'button');
                    locationSearchResultButton.setAttribute('value', 'Tag');
                    locationSearchResultButton.setAttribute('onclick', `handleLocationResultButtonClick('${location.id}', '${location.name}')`);
                    locationSearchResultButton.classList.add('location-search-result');

                    const locationSearchResultNameCell = document.createElement('td');
                    locationSearchResultNameCell.classList.add('location-search-result-name');
                    locationSearchResultNameCell.innerHTML = locationSearchResultName.outerHTML;

                    const locationSearchResultButtonCell = document.createElement('td');
                    locationSearchResultButtonCell.classList.add('location-search-result-button');
                    locationSearchResultButtonCell.innerHTML = locationSearchResultButton.outerHTML;

                    locationSearchResult.innerHTML = locationSearchResultNameCell.outerHTML + locationSearchResultButtonCell.outerHTML;
                    locationSearchResults.appendChild(locationSearchResult);
                }
            }
        } catch (error) {
            console.error('There was an error:', error);
        } finally {
            searchButton.disabled = false;
        }
    });
}
