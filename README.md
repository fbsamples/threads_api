# Threads Publishing API Sample App

> ⚠️ We will update the sample app over time. Please note that all of the latest features may not be demonstrated in the sample app. Please refer to the [developer documentation changelog](https://developers.facebook.com/docs/threads/changelog) for the most up-to-date features.

You can use this Sample App to test the [Threads API](https://developers.facebook.com/docs/threads).

1. Make sure that you are using the APP ID and Secret defined for the Threads API of your app. These ARE not the same as the regular app ID and app secret.
2. Make sure you add your application's redirect URL e.g. https://threads-sample.meta:8000/callback, to your app's redirect callback URLs in the app dashboard.

## Required software

In order to run the Sample App you will need to install some required software, as follows:

- Node JS

## Running the Sample App

Note: If you are using devcontainers, ensure that containers are enabled and supported by your IDE.

1. Install necessary tools
    * If you are using a [devcontainer](https://code.visualstudio.com/docs/devcontainers/containers), skip to step 2.
    * Install [nodeJS](https://nodejs.org/en/download/) to run the application. If you're using a Mac, you can install it via Homebrew: `brew install node`
    * Install [mkcert](https://mkcert.org/) to create the OpenSSL Certificate. If you're using a Mac, you can install it via Homebrew: `brew install mkcert`

2. Run `npm install` in your terminal

3. Create a new file called `.env` and copy/paste all the environment variables from `.env.template`. Replace any environnment variables that have placeholders, such as APP_ID.

4. Map a domain to your local machine for local development
    * Note: Threads apps do not support redirect URLs with using `localhost` so you must map a domain to test locally this Sample App.
    * Map a new entry in your hosts file to the domain that you will use to test the Sample App e.g. `threads-sample.meta`.
    * If you're using a Linux or Mac, this will be your `/etc/hosts` file.
    * Add an entry like so:
        ```
        127.0.0.1   threads-sample.meta
        ```
    * This will map threads-sample.meta to localhost, so you may visit https://threads-sample.meta:8000 to see the Threads Sample App.
    * This domain must match the one defined in your `.env` file as the value of the `HOST` variable.

5. Create an OpenSSL Cert
    * OAuth redirects are only supported over HTTPS so you must create an SSL certificate
    * `mkcert threads-sample.meta` - This will create pem files for SSL.
    * You will see `threads-sample.meta.pem` and `threads-sample.meta-key.pem `files generated.
    * If you are using a host that is different than `threads-sample.meta` then replace it with your specific domain.

6. Run the Sample App
    * Run `npm start` from the command line.
    * Once the Sample App starts running, go to https://threads-sample.meta:8000 to test the workflow.
    * If you are using a different domain or port then replace those values accordingly.

## License
Threads API is Meta Platform Policy licensed, as found in the LICENSE file.
