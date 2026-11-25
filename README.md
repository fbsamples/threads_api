# Threads Publishing API Sample App

> ⚠️ We will update the sample app over time. Please note that all of the latest features may not be demonstrated in the sample app. Please refer to the [developer documentation changelog](https://developers.facebook.com/docs/threads/changelog) for the most up-to-date features.

You can use this Sample App to test the [Threads API](https://developers.facebook.com/docs/threads).

1. Make sure that you are using the APP ID and Secret defined for the Threads API of your app. These ARE not the same as the regular app ID and app secret.
2. Make sure you add your application's redirect URL e.g. https://threads-sample.meta:8000/callback, to your app's redirect callback URLs in the app dashboard.

## Features

-   **Login and Account:** Sign in through the Threads oAuth flow and exchange short-lived tokens for long-lived tokens. Authenticated requests use the Threads app-scoped user ID returned during sign-in. View your profile details and sign out.
-   **Publishing:** Publish text, image, video, and carousel posts. This sample accepts up to 20 media attachments per post. Carousel items are numbered in their current order and renumbered when an item is removed. Check container status before publishing. You can also publish text posts automatically during the container creation phase.
-   **Publishing Options:** Add topic tags, link attachments, alt text, and polls. Link and poll controls are hidden and disabled while media is attached. Removing the last media item restores them. Mark text or media as spoilers. Create temporary ghost posts that automatically expire. Choose who can reply by setting the reply audience.
-   **Replies, Quotes, and Reposts:** Create replies and quote posts, or repost an existing post.
-   **Post Browsing:** View your posts, your replies, and posts that mention you. Open individual post details, direct replies, and full conversations. Browse available result pages.
-   **Reply Management:** The direct-replies view includes controls to Hide and Unhide replies.
-   **Search:** Search by keyword or topic tag with Top or Recent results. Filter by date, media type, and author username. Set the page size. Search state is retained through paging and errors. Results show returned topic tags and dates in your browser’s local timezone. Read the [Search Guide](https://developers.facebook.com/documentation/threads/keyword-search) for parameters and limits.
-   **Public Profiles:** Look up a public profile, view its details, and browse its posts.
-   **Post Insights:** See post metrics for views, likes, replies, reposts, quotes, and shares.
-   **User Insights:** See account metrics for views, likes, replies, reposts, quotes, clicks, and follower count. The page includes date range filters.
-   **Quotas:** View API usage for publishing, replies, deletion, and location search. Use Refresh Counts to reload the reported usage. The page also reloads when you return to its tab or restore it from browser history.
-   **Token Debugging:** Inspect the access token's application name, granted permissions, app-scoped user ID, issued timestamp, and expiration date.
-   **Post and Profile Embeds:** Preview a public Threads post or profile without an access token. Choose Light, Dark, or Auto for the embed theme. Auto follows the viewer's display settings.
-   **Deletion:** Use the trash button on your posts list or post details page to delete a post you own. Confirm the warning to continue. The sample app checks that you own the post. You return to your remaining posts only after the API confirms success. This action cannot be undone, and reposts are unsupported. The route allows 10 requests per minute per IPv4 address or IPv6 subnet within one app process. Use a test app and test user. View [Delete Posts](https://developers.facebook.com/documentation/threads/posts/delete-posts) for permissions and limits.
-   **Postman Collection:** Use the public [Threads Postman Collection](https://www.postman.com/meta/threads/overview) or import `postman/threads-api.postman_collection.json` into Postman. Set `user_id` to the app-scoped ID for your access token, using the profile request to look it up if needed. The token exchange and profile lookup save it when `auto_save_variables` is enabled.

## Required software

In order to run the Sample App you will need to install some required software, as follows:

-   Node.js 18 or later

## Running the Sample App

Note: If you are using devcontainers, ensure that containers are enabled and supported by your IDE.

1. Install necessary tools

    - If you are using a [devcontainer](https://code.visualstudio.com/docs/devcontainers/containers), skip to step 2.
    - Install [nodeJS](https://nodejs.org/en/download/) to run the application. If you're using a Mac, you can install it via Homebrew: `brew install node`
    - Install [mkcert](https://mkcert.org/) to create the OpenSSL Certificate. If you're using a Mac, you can install it via Homebrew: `brew install mkcert`

2. Run `npm install` in your terminal

3. Create a new file called `.env` and copy/paste all the environment variables from `.env.template`. Replace any environnment variables that have placeholders, such as APP_ID.

4. Map a domain to your local machine for local development

    - Note: Threads apps do not support redirect URLs with using `localhost` so you must map a domain to test locally this Sample App.
    - Map a new entry in your hosts file to the domain that you will use to test the Sample App e.g. `threads-sample.meta`.
    - If you're using a Linux or Mac, this will be your `/etc/hosts` file.
    - Add an entry like so:
        ```
        127.0.0.1   threads-sample.meta
        ```
    - This will map threads-sample.meta to localhost, so you may visit https://threads-sample.meta:8000 to see the Threads Sample App.
    - This domain must match the one defined in your `.env` file as the value of the `HOST` variable.

5. Create an OpenSSL Cert

    - OAuth redirects are only supported over HTTPS so you must create an SSL certificate
    - `mkcert threads-sample.meta` - This will create pem files for SSL.
    - You will see `threads-sample.meta.pem` and `threads-sample.meta-key.pem `files generated.
    - If you are using a host that is different than `threads-sample.meta` then replace it with your specific domain.

6. Run the Sample App
    - Run `npm start` from the command line.
    - Once the Sample App starts running, go to https://threads-sample.meta:8000 to test the workflow.
    - If you are using a different domain or port then replace those values accordingly.

## Tests

Run `npm test` to check search modes, filters, and pagination with mocked API responses. These tests do not call the Threads API.

## License

Threads API is Meta Platform Policy licensed, as found in the LICENSE file.
