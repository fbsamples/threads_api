# Threads API Sample App

Use this app to try the [Threads API](https://developers.facebook.com/documentation/threads) with a local web interface and Postman examples. The app does not demonstrate every API feature. See the [Changelog](https://developers.facebook.com/documentation/threads/changelog) for current API capabilities.

## Setup

You need Node.js 18 or later and [mkcert](https://github.com/FiloSottile/mkcert). You can also use the repository's [Dev Container](https://code.visualstudio.com/docs/devcontainers/containers).

1. Install dependencies with `npm install`.
2. Copy `.env.template` to `.env`. Set `APP_ID` and `API_SECRET` to the Threads app ID and Threads app secret from your app dashboard. They differ from the app's main app ID and app secret. Replace `SESSION_SECRET` with a random value.
3. Add `https://threads-sample.meta:8000/callback` to your app's allowed redirect URLs. Keep it consistent with `REDIRECT_URI` in `.env`.
4. Add the following entry to your hosts file (`/etc/hosts` on macOS or Linux):

    ```text
    127.0.0.1 threads-sample.meta
    ```

5. For first-time certificate setup, run `mkcert -install`. This installs a local certificate authority and changes your system or browser trust store.
6. Run `mkcert threads-sample.meta` from the repository root. This creates `threads-sample.meta.pem` and `threads-sample.meta-key.pem` for local HTTPS.
7. Run `npm start`, then open `https://threads-sample.meta:8000` and sign in.

If you use another domain or port, update `HOST`, `PORT`, `REDIRECT_URI`, the hosts entry, certificate filenames and app redirect settings together. OAuth redirects require HTTPS. Threads redirect URLs cannot use `localhost`, so the sample uses a mapped domain.

If you use a Dev Container, installing the CA inside it does not make your host browser trust it. Follow [Installing the CA on Other Systems](https://github.com/FiloSottile/mkcert#installing-the-ca-on-other-systems) to trust that CA on the host without copying its private key.

Keep `.env`, access tokens, private certificate keys and mkcert's CA private key local. Never add them to commits, screenshots or shared examples. Use a test app and test user when trying publishing, reply management or deletion.

## Features

-   **Publishing.** Create text, image, video and carousel posts. Try replies, quotes, reposts, topic tags, links, alternative text, polls, spoilers and ghost posts. The upload form includes an auto-publish option for text posts.
-   **Post Browsing.** View your posts, replies and mentions, inspect post details, and browse direct replies or a conversation.
-   **Reply Management.** The direct-replies view includes Hide and Unhide controls.
-   **Search.** Search by keyword or topic tag with Top or Recent results. Refine by date, page size, media type or author username. Search state is retained through paging and errors. Creation times are shown in UTC. See the [Search Guide](https://developers.facebook.com/documentation/threads/keyword-search) for options, permissions and limits.
-   **Profiles.** Look up a public profile and browse its posts.
-   **Insights.** View user and post metrics. Use Since and Until to filter by date.
-   **Tools.** Inspect an access token, view publishing quotas, and try oEmbed with a post URL.
-   **Deletion.** Delete eligible posts you own from the posts list or post details. See the guidance below.

API permissions and restrictions still apply. Start with the [Developer Documentation](https://developers.facebook.com/documentation/threads) for each workflow.

### Delete Your Posts

Use the trash button beside an eligible post in your list, or Delete after Quote and Repost on its detail page. Confirm to continue, or cancel to leave the post unchanged. Deletion cannot be undone. The app checks the authenticated user and post owner, and returns to the list only after the API confirms success. Reposts are not supported for deletion in this sample.

Deletion requires `threads_delete`. The route allows 10 requests per minute per IPv4 address or IPv6 subnet within one running app process. See [Delete Posts](https://developers.facebook.com/documentation/threads/posts/delete-posts) for API permissions and limits.

## Postman Examples

The collection is in `postman/threads-api.postman_collection.json`. Import it into Postman to explore request examples. Examples can cover API options that are not exposed in the web interface. Keep real credentials in your local environment, not in the collection.

## Testing and Small Changes

Run `npm test` for mocked search modes, filters, pagination, deletion and error-rendering regressions. These tests do not call the Threads API. Check formatting on the files you change, for example `npx prettier --check README.md`.

For people and coding agents changing the sample:

-   Keep each change focused and easy to review. Read the current public API documentation before adding a field or endpoint.
-   Keep backend routes in `src/index.js`, use CommonJS and the existing `FIELD__`, `PARAMS__` and `MEDIA_TYPE__` constants, and use Pug templates in `views/`.
-   Add a small regression for the behavior you change. Update setup instructions, `.env.template` or Postman examples when relevant.
-   Keep feature descriptions brief and consistent with this overview. Preserve necessary safety guidance without adding large feature-specific sections or repeated testing text.
-   Use synthetic values in fixtures. Report only checks that actually ran, and keep secrets and user data out of the repository.

## License

Threads API is Meta Platform Policy licensed, as found in the LICENSE file.
