/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const axios = require('axios');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { URLSearchParams, URL } = require('url');
const multer = require('multer');

const app = express();
const upload = multer();

const DEFAULT_THREADS_QUERY_LIMIT = 10;

const FIELD__ERROR_MESSAGE = 'error_message';
const FIELD__FOLLOWERS_COUNT = 'followers_count';
const FIELD__HIDE_STATUS = 'hide_status';
const FIELD__IS_REPLY = 'is_reply';
const FIELD__LIKES = 'likes';
const FIELD__MEDIA_TYPE = 'media_type';
const FIELD__MEDIA_URL = 'media_url';
const FIELD__PERMALINK = 'permalink';
const FIELD__REPLIES = 'replies';
const FIELD__REPOSTS = 'reposts';
const FIELD__QUOTES = 'quotes';
const FIELD__REPLY_AUDIENCE = 'reply_audience';
const FIELD__STATUS = 'status';
const FIELD__TEXT = 'text';
const FIELD__TIMESTAMP = 'timestamp';
const FIELD__THREADS_BIOGRAPHY = 'threads_biography';
const FIELD__THREADS_PROFILE_PICTURE_URL = 'threads_profile_picture_url';
const FIELD__USERNAME = 'username';
const FIELD__VIEWS = 'views';

const MEDIA_TYPE__CAROUSEL = 'CAROUSEL';
const MEDIA_TYPE__IMAGE = 'IMAGE';
const MEDIA_TYPE__TEXT = 'TEXT';
const MEDIA_TYPE__VIDEO = 'VIDEO';

const PARAMS__ACCESS_TOKEN = 'access_token';
const PARAMS__CLIENT_ID = 'client_id';
const PARAMS__CONFIG = 'config';
const PARAMS__FIELDS = 'fields';
const PARAMS__HIDE = 'hide';
const PARAMS__METRIC = 'metric';
const PARAMS__QUOTA_USAGE = 'quota_usage';
const PARAMS__REDIRECT_URI = 'redirect_uri';
const PARAMS__REPLY_CONFIG = 'reply_config';
const PARAMS__REPLY_CONTROL = 'reply_control';
const PARAMS__REPLY_QUOTA_USAGE = 'reply_quota_usage';
const PARAMS__REPLY_TO_ID = 'reply_to_id';
const PARAMS__RESPONSE_TYPE = 'response_type';
const PARAMS__RETURN_URL = 'return_url';
const PARAMS__SCOPE = 'scope';
const PARAMS__TEXT = 'text';

// Read variables from environment
require('dotenv').config();
const {
    HOST,
    PORT,
    REDIRECT_URI,
    APP_ID,
    API_SECRET,
    GRAPH_API_VERSION,
    INITIAL_ACCESS_TOKEN,
    INITIAL_USER_ID,
} = process.env;

const GRAPH_API_BASE_URL = 'https://graph.threads.net/' +
    (GRAPH_API_VERSION ? GRAPH_API_VERSION + '/' : '');
const AUTHORIZATION_BASE_URL = 'https://www.threads.net';

let initial_access_token = INITIAL_ACCESS_TOKEN;
let initial_user_id = INITIAL_USER_ID;

// Access scopes required for the token
const SCOPES = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_insights',
    'threads_manage_replies',
    'threads_read_replies'
];

app.use(express.static('public'));
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'pug');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        cookie: {
            maxAge: 6000000,
        },
    })
);

// Middleware to ensure the user is logged in
const loggedInUserChecker = (req, res, next) => {
    if (req.session.access_token) {
        next();
    } else if (initial_access_token && initial_user_id) {
        useInitialAuthenticationValues(req);
        next();
    } else {
        const returnUrl = encodeURIComponent(req.originalUrl);
        res.redirect(`/?${PARAMS__RETURN_URL}=${returnUrl}`);
    }
};

app.get('/', async (req, res) => {
    if (!(req.session.access_token) &&
        (initial_access_token && initial_user_id)) {
        useInitialAuthenticationValues(req);
        res.redirect('/account');
    } else {
        res.render('index', {
            title: 'Index',
            returnUrl: req.query[PARAMS__RETURN_URL],
        });
    }
});

// Login route using OAuth
app.get('/login', (req, res) => {
    const url = buildGraphAPIURL('oauth/authorize', {
        [PARAMS__SCOPE]: SCOPES.join(','),
        [PARAMS__CLIENT_ID]: APP_ID,
        [PARAMS__REDIRECT_URI]: REDIRECT_URI,
        [PARAMS__RESPONSE_TYPE]: 'code',
    }, null, AUTHORIZATION_BASE_URL);

    res.redirect(url);
});

// Callback route for OAuth user token And reroute to '/pages'
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const uri = buildGraphAPIURL('oauth/access_token', {}, null, GRAPH_API_BASE_URL);

    try {
        const response = await axios.post(uri, new URLSearchParams({
            client_id: APP_ID,
            client_secret: API_SECRET,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI,
            code,
        }).toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        req.session.access_token = response.data.access_token;
        res.redirect('/account');
    } catch (err) {
        console.error(err?.response?.data);
        res.render('index', {
            error: `There was an error with the request: ${err}`,
        });
    }
});

app.get('/account', loggedInUserChecker, async (req, res) => {
    const getUserDetailsUrl = buildGraphAPIURL('me', {
        [PARAMS__FIELDS]: [
            FIELD__USERNAME,
            FIELD__THREADS_PROFILE_PICTURE_URL,
            FIELD__THREADS_BIOGRAPHY,
        ].join(','),
    }, req.session.access_token);

    let userDetails = {};
    try {
        const response = await axios.get(getUserDetailsUrl);
        userDetails = response.data;

        // This value is not currently used but it may come handy in the future
        if (!req.session.user_id)
            req.session.user_id = response.data.id;

        userDetails.user_profile_url = `https://www.threads.net/@${userDetails.username}`;
    } catch (e) {
        console.error(e);
    }

    res.render('account', {
        title: 'Account',
        ...userDetails,
    });
});

app.get('/userInsights', loggedInUserChecker, async (req, res) => {
    const { since, until } = req.query;

    const params = {
        [PARAMS__METRIC]: [
            FIELD__VIEWS,
            FIELD__LIKES,
            FIELD__REPLIES,
            FIELD__QUOTES,
            FIELD__REPOSTS,
            FIELD__FOLLOWERS_COUNT,
        ].join(',')
    };
    if (since) {
        params.since = since;
    }
    if (until) {
        params.until = until;
    }

    const queryThreadUrl = buildGraphAPIURL(`me/threads_insights`, params, req.session.access_token);

    let data = [];
    try {
        const queryResponse = await axios.get(queryThreadUrl);
        data = queryResponse.data;
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    const metrics = data?.data ?? [];
    for (const index in metrics) {
        const metric = metrics[index];
        if (metric.name === FIELD__VIEWS) {
            // The "views" metric returns as a value for user insights
            getInsightsValue(metrics, index);
        }
        else {
            // All other metrics return as a total value
            getInsightsTotalValue(metrics, index);
        }
    }

    res.render('user_insights', {
        title: 'User Insights',
        metrics,
        since,
        until,
    });
});

app.get('/publishingLimit', loggedInUserChecker, async (req, res) => {
    const params = {
        [PARAMS__FIELDS]: [
            PARAMS__QUOTA_USAGE,
            PARAMS__CONFIG,
            PARAMS__REPLY_QUOTA_USAGE,
            PARAMS__REPLY_CONFIG
        ].join(','),
    };

    const publishingLimitUrl = buildGraphAPIURL(`me/threads_publishing_limit`, params, req.session.access_token);

    let data = [];
    try {
        const queryResponse = await axios.get(publishingLimitUrl);
        data = queryResponse.data;
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    data = data.data?.[0] ?? {};

    const quotaUsage = data[PARAMS__QUOTA_USAGE];
    const config = data[PARAMS__CONFIG];
    const replyQuotaUsage = data[PARAMS__REPLY_QUOTA_USAGE];
    const replyConfig = data[PARAMS__REPLY_CONFIG];

    res.render('publishing_limit', {
        title: 'Publishing Limit',
        quotaUsage,
        config,
        replyQuotaUsage,
        replyConfig,
    });
});

app.get('/upload', loggedInUserChecker, (req, res) => {
    const { replyToId } = req.query;
    const title = replyToId === undefined ? 'Upload' : 'Upload (Reply)';
    res.render('upload', {
        title,
        replyToId
    });
});

app.post('/upload', upload.array(), async (req, res) => {
    const { text, attachmentType, attachmentUrl, replyControl, replyToId } = req.body;
    const params = {
        [PARAMS__TEXT]: text,
        [PARAMS__REPLY_CONTROL]: replyControl,
        [PARAMS__REPLY_TO_ID]: replyToId,
    };

    // No attachments
    if (!attachmentType?.length) {
        params.media_type = MEDIA_TYPE__TEXT;
    }
    // Single attachment
    else if (attachmentType?.length === 1) {
        addAttachmentFields(params, attachmentType[0], attachmentUrl[0]);
    }
    // Multiple attachments
    else {
        params.media_type = MEDIA_TYPE__CAROUSEL;
        params.children = [];
        attachmentType.forEach((type, i) => {
            const child = {
                is_carousel_item: true,
            };
            addAttachmentFields(child, type, attachmentUrl[i]);
            params.children.push(child);
        });
    }

    if (params.media_type === MEDIA_TYPE__CAROUSEL) {
        const createChildPromises = params.children.map(child => (
            axios.post(
                buildGraphAPIURL(`me/threads`, child, req.session.access_token),
                {},
            )
        ));
        try {
            const createCarouselItemResponse = await Promise.all(createChildPromises);
            // Replace children with the IDs
            params.children = createCarouselItemResponse
                .filter(response => response.status === 200)
                .map(response => response.data.id)
                .join(',');
        } catch (e) {
            console.error(e.message);
            res.json({
                error: true,
                message: `Error creating child elements: ${e}`,
            });
            return;
        }
    }

    const postThreadsUrl = buildGraphAPIURL(`me/threads`, params, req.session.access_token);
    try {
        const postResponse = await axios.post(postThreadsUrl, {});
        const containerId = postResponse.data.id;
        res.json({
            id: containerId,
        });
    }
    catch (e) {
        console.error(e.message);
        res.json({
            error: true,
            message: `Error during upload: ${e}`,
        });
    }
});

app.get('/publish/:containerId', loggedInUserChecker, async (req, res) => {
    const containerId = req.params.containerId;
    res.render('publish', {
        containerId,
        title: 'Publish',
    });
});

app.get('/container/status/:containerId', loggedInUserChecker, async (req, res) => {
    const { containerId } = req.params;
    const getContainerStatusUrl = buildGraphAPIURL(containerId, {
        [PARAMS__FIELDS]: [
            FIELD__STATUS,
            FIELD__ERROR_MESSAGE
        ].join(','),
    }, req.session.access_token);

    try {
        const queryResponse = await axios.get(getContainerStatusUrl);
        res.json(queryResponse.data);
    } catch (e) {
        console.error(e.message);
        res.json({
            error: true,
            message: `Error querying container status: ${e}`,
        });
    }
});

app.post('/publish', upload.array(), async (req, res) => {
    const { containerId } = req.body;
    const publishThreadsUrl = buildGraphAPIURL(`me/threads_publish`, {
        creation_id: containerId,
    }, req.session.access_token);

    try {
        const postResponse = await axios.post(publishThreadsUrl);
        const threadId = postResponse.data.id;
        res.json({
            id: threadId,
        });
    }
    catch (e) {
        console.error(e.message);
        res.json({
            error: true,
            message: `Error during publishing: ${e}`,
        });
    }
});

app.get('/threads/:threadId', loggedInUserChecker, async (req, res) => {
    const { threadId } = req.params;
    let data = {};
    const queryThreadUrl = buildGraphAPIURL(`${threadId}`, {
        [PARAMS__FIELDS]: [
            FIELD__TEXT,
            FIELD__MEDIA_TYPE,
            FIELD__MEDIA_URL,
            FIELD__PERMALINK,
            FIELD__TIMESTAMP,
            FIELD__IS_REPLY,
            FIELD__USERNAME,
            FIELD__REPLY_AUDIENCE
        ].join(','),
    }, req.session.access_token);

    try {
        const queryResponse = await axios.get(queryThreadUrl);
        data = queryResponse.data;
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    res.render('thread', {
        threadId,
        ...data,
        title: 'Thread',
    });
});

app.get('/threads', loggedInUserChecker, async (req, res) => {
    const { before, after, limit } = req.query;
    const params = {
        [PARAMS__FIELDS]: [
            FIELD__TEXT,
            FIELD__MEDIA_TYPE,
            FIELD__MEDIA_URL,
            FIELD__PERMALINK,
            FIELD__TIMESTAMP,
            FIELD__REPLY_AUDIENCE,
        ].join(','),
        limit: limit ?? DEFAULT_THREADS_QUERY_LIMIT,
    };
    if (before) {
        params.before = before;
    }
    if (after) {
        params.after = after;
    }

    let threads = [];
    let paging = {};

    const queryThreadsUrl = buildGraphAPIURL(`me/threads`, params, req.session.access_token);

    try {
        const queryResponse = await axios.get(queryThreadsUrl);
        threads = queryResponse.data.data;

        if (queryResponse.data.paging) {
            const { next, previous } = queryResponse.data.paging;

            if (next) {
                paging.nextUrl = getCursorUrlFromGraphApiPagingUrl(req, next);
            }

            if (previous) {
                paging.previousUrl = getCursorUrlFromGraphApiPagingUrl(req, previous);
            }
        }
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    res.render('threads', {
        paging,
        threads,
        title: 'Threads',
    });
});

app.get('/threads/:threadId/replies', loggedInUserChecker, (req, res) => {
    showReplies(req, res, true);
});

app.get('/threads/:threadId/conversation', loggedInUserChecker, (req, res) => {
    showReplies(req, res, false);
});

app.post('/manage_reply/:replyId', upload.array(), async (req, res) => {
    const { replyId } = req.params;
    const { hide } = req.query;

    const params = {};
    if (hide) {
        params[PARAMS__HIDE] = hide === 'true';
    }

    const hideReplyUrl = buildGraphAPIURL(`${replyId}/manage_reply`, {}, req.session.access_token);

    try {
        response = await axios.post(hideReplyUrl, params);
    }
    catch (e) {
        console.error(e?.message);
        return res.status(e?.response?.status ?? 500).json({
            error: true,
            message: `Error while hiding reply: ${e}`,
        });
    }

    return res.sendStatus(200);
});

app.get('/threads/:threadId/insights', loggedInUserChecker, async (req, res) => {
    const { threadId } = req.params;
    const { since, until } = req.query;

    const params = {
        [PARAMS__METRIC]: [
            FIELD__VIEWS,
            FIELD__LIKES,
            FIELD__REPLIES,
            FIELD__REPOSTS,
            FIELD__QUOTES,
        ].join(',')
    };
    if (since) {
        params.since = since;
    }
    if (until) {
        params.until = until;
    }

    const queryThreadUrl = buildGraphAPIURL(`${threadId}/insights`, params, req.session.access_token);

    let data = [];
    try {
        const queryResponse = await axios.get(queryThreadUrl);
        data = queryResponse.data;
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    const metrics = data?.data ?? [];
    for (const index in metrics) {
        // All metrics return as a value (rather than total value) for media insights
        getInsightsValue(metrics, index);
    }

    res.render('thread_insights', {
        title: 'Thread Insights',
        threadId,
        metrics,
        since,
        until,
    });
});

// Logout route to kill the session
app.get('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                res.render('index', { error: 'Unable to log out' });
            } else {
                res.render('index', { response: 'Logout successful!' });
            }
        });
    } else {
        res.render('index', { response: 'Token not stored in session' });
    }
});

https
    .createServer({
        key: fs.readFileSync(path.join(__dirname, '../threads-sample.meta-key.pem')),
        cert: fs.readFileSync(path.join(__dirname, '../threads-sample.meta.pem')),
    }, app)
    .listen(PORT, HOST, (err) => {
        if (err) {
            console.error(`Error: ${err}`);
        }
        console.log(`listening on port ${PORT}!`);
    });

/**
 * @param {string} path
 * @param {URLSearchParams} searchParams
 * @param {string} accessToken
 * @param {string} base_url
 */
function buildGraphAPIURL(path, searchParams, accessToken, base_url) {
    const url = new URL(path, base_url ?? GRAPH_API_BASE_URL);

    url.search = new URLSearchParams(searchParams);
    if (accessToken) {
        url.searchParams.append(PARAMS__ACCESS_TOKEN, accessToken);
    }

    return url.toString();
}
/**
 * @param {Request} req
 */
function useInitialAuthenticationValues(req) {
    // Use initial values
    req.session.access_token = initial_access_token;
    req.session.user_id = initial_user_id;
    // Clear initial values to enable signing out
    initial_access_token = undefined;
    initial_user_id = undefined;
}

/**
 * @param {{ value?: number, values: { value: number }[] }[]} metrics
 * @param {*} index
 */
function getInsightsValue(metrics, index) {
    if (metrics[index]) {
        metrics[index].value = metrics[index].values?.[0]?.value;
    }
}

/**
 * @param {{ value?: number, total_value: { value: number } }[]} metrics
 * @param {number} index
 */
function getInsightsTotalValue(metrics, index) {
    if (metrics[index]) {
        metrics[index].value = metrics[index].total_value?.value;
    }
}

/**
 * @param {object} target
 * @param {string} attachmentType
 * @param {string} url
 */
function addAttachmentFields(target, attachmentType, url) {
    if (attachmentType === 'Image') {
        target.media_type = MEDIA_TYPE__IMAGE;
        target.image_url = url;
    } else if (attachmentType === 'Video') {
        target.media_type = MEDIA_TYPE__VIDEO;
        target.video_url = url;
    }
}

/**
 * @param {URL} sourceUrl
 * @param {URL} destinationUrl
 * @param {string} paramName
 */
function setUrlParamIfPresent(sourceUrl, destinationUrl, paramName) {
    const paramValue = sourceUrl.searchParams.get(paramName);
    if (paramValue) {
        destinationUrl.searchParams.set(paramName, paramValue);
    }
}

/**
 * @param {Request} req
 * @param {string} graphApiPagingUrl
 */
function getCursorUrlFromGraphApiPagingUrl(req, graphApiPagingUrl) {
    const graphUrl = new URL(graphApiPagingUrl);

    const cursorUrl = new URL(req.protocol + '://' + req.get('host') + req.originalUrl);
    cursorUrl.search = '';

    setUrlParamIfPresent(graphUrl, cursorUrl, 'limit');
    setUrlParamIfPresent(graphUrl, cursorUrl, 'before');
    setUrlParamIfPresent(graphUrl, cursorUrl, 'after');

    return cursorUrl.href;
}

/**
 * @param {Request} req
 * @param {Response} res
 * @param {boolean} [isTopLevel]
 */
async function showReplies(req, res, isTopLevel) {
    const { threadId } = req.params;
    const { username, before, after, limit } = req.query;

    const params = {
        [PARAMS__FIELDS]: [
            FIELD__TEXT,
            FIELD__MEDIA_TYPE,
            FIELD__MEDIA_URL,
            FIELD__PERMALINK,
            FIELD__TIMESTAMP,
            FIELD__USERNAME,
            FIELD__HIDE_STATUS,
        ].join(','),
        limit: limit ?? DEFAULT_THREADS_QUERY_LIMIT,
    };
    if (before) {
        params.before = before;
    }
    if (after) {
        params.after = after;
    }

    let replies = [];
    let paging = {};

    const repliesOrConversation = isTopLevel ? 'replies' : 'conversation';
    const queryThreadsUrl = buildGraphAPIURL(`${threadId}/${repliesOrConversation}`, params, req.session.access_token);

    try {
        const queryResponse = await axios.get(queryThreadsUrl);
        replies = queryResponse.data.data;

        if (queryResponse.data.paging) {
            const { next, previous } = queryResponse.data.paging;

            if (next)
                paging.nextUrl = getCursorUrlFromGraphApiPagingUrl(req, next);

            if (previous)
                paging.previousUrl = getCursorUrlFromGraphApiPagingUrl(req, previous);
        }
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    res.render(isTopLevel ? 'thread_replies' : 'thread_conversation', {
        threadId,
        username,
        paging,
        replies,
        manage: isTopLevel ? true : false,
        title: 'Replies',
    });
}
