# Threads Publishing API Sample App

> ⚠️ We will update the sample app over time. Please note that all of the latest features may not be demonstrated in the sample app. Please refer to the [developer documentation changelog](https://developers.facebook.com/docs/threads/changelog) for the most up-to-date features.

You can use this Sample App to test the [Threads API](https://developers.facebook.com/docs/threads).

1. Make sure that you are using the APP ID and Secret defined for the Threads API of your app. These ARE not the same as the regular app ID and app secret.
2. Make sure you add your application's redirect URL e.g. https://threads-sample.meta:8000/callback, to your app's redirect callback URLs in the app dashboard.

## Delete Your Posts

On the Threads page, use the trash button beside one of your posts to delete it. Eligible post detail pages also show Delete after Quote and Repost. Confirm the warning to continue, or cancel to leave the post unchanged. Deletion cannot be undone.

The app checks the authenticated user and post owner before requesting deletion. It returns to your posts only after the API confirms success. Delete controls are shown on your posts list and eligible post detail pages, not the replies list. Reposts are not supported.

Deletion requires `threads_delete`. See [Delete Posts](https://developers.facebook.com/documentation/threads/posts/delete-posts) for permissions and limits. Use a test app and test user when trying this feature.

The deletion route uses `express-rate-limit` to allow 10 requests per minute per IPv4 address or IPv6 subnet. Limits apply within one running app process. Excess requests show a retry message without calling the API.

Run `npm test` to check deletion safeguards with mocked API responses. These tests do not call the Threads API.

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

## Keyword and Topic Tag Search

Choose Keyword or Topic Tag under Search Mode. Enter your query and select Top or Recent under Results Order.

Use Previous or Next to browse results. Your query and search mode stay unchanged between pages. If a search fails, the page shows an error without clearing your selections.

The results table shows each post's returned topic tag. A missing tag leaves the cell blank. Creation dates are shown in UTC. If a date cannot be parsed, the table keeps its original text.

Use Since and Until to filter by date or Unix timestamp. Page Size accepts a whole number from 0 to 100. Leave optional filters blank to use the API defaults. The form keeps your filters when a request returns an error.

See [Keyword and Topic Tag Search](https://developers.facebook.com/documentation/threads/keyword-search) for permissions and limits.

## Tests

Run `npm test` to check search modes, filters and pagination with mocked API responses. These tests do not call the Threads API.

## License

Threads API is Meta Platform Policy licensed, as found in the LICENSE file.
