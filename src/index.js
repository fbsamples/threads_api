/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 */

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const session = require('express-session');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Buffer } = require('node:buffer');
const crypto = require('crypto');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { URLSearchParams, URL } = require('url');
const multer = require('multer');
const { DateTime } = require('luxon');
const { setTimeout, clearTimeout } = require('node:timers');
const textParser = require('../public/scripts/text-parser.js');

const spoilerMarker = '**spoiler**';
const app = express();
const upload = multer();

const DEFAULT_THREADS_QUERY_LIMIT = 10;

const FIELD__ALT_TEXT = 'alt_text';
const FIELD__APPLICATION = 'application';
const FIELD__APP_SCOPED_USER_ID = 'user_id';
const FIELD__CLICKS = 'clicks';
const FIELD__ERROR_MESSAGE = 'error_message';
const FIELD__EXPIRES_AT = 'expires_at';
const FIELD__FOLLOWERS_COUNT = 'followers_count';
const FIELD__HIDE_STATUS = 'hide_status';
const FIELD__ID = 'id';
const FIELD__ISSUED_AT = 'issued_at';
const FIELD__IS_REPLY = 'is_reply';
const FIELD__IS_VERIFIED = 'is_verified';
const FIELD__IS_QUOTE_POST = 'is_quote_post';
const FIELD__LIKES = 'likes';
const FIELD__LINK_ATTACHMENT_URL = 'link_attachment_url';
const FIELD__TOPIC_TAG = 'topic_tag';
const FIELD__MEDIA_TYPE = 'media_type';
const FIELD__MEDIA_URL = 'media_url';
const FIELD__NAME = 'name';
const FIELD__OWNER = 'owner';
const FIELD__GIF_URL = 'gif_url';
const FIELD__PERMALINK = 'permalink';
const FIELD__POLL_ATTACHMENT = 'poll_attachment';
const FIELD__REPLIES = 'replies';
const FIELD__REPOSTS = 'reposts';
const FIELD__QUOTED_POST = 'quoted_post';
const FIELD__QUOTES = 'quotes';
const FIELD__REPLY_AUDIENCE = 'reply_audience';
const FIELD__REPOSTED_POST = 'reposted_post';
const FIELD__SCOPES = 'scopes';
const FIELD__SHARES = 'shares';
const FIELD__STATUS = 'status';
const FIELD__TEXT = 'text';
const FIELD__TIMESTAMP = 'timestamp';
const FIELD__THREADS_BIOGRAPHY = 'threads_biography';
const FIELD__THREADS_PROFILE_PICTURE_URL = 'threads_profile_picture_url';
const FIELD__USERNAME = 'username';
const FIELD__VIEWS = 'views';
const FIELD_IS_SPOILER_MEDIA = 'is_spoiler_media';
const FIELD_TEXT_ENTITES = 'text_entities';
const FIELD_GHOST_POST_STATUS = 'ghost_post_status';

const MEDIA_TYPE__AUDIO = 'AUDIO';
const MEDIA_TYPE__CAROUSEL = 'CAROUSEL';
const MEDIA_TYPE__CAROUSEL_ALBUM = 'CAROUSEL_ALBUM';
const MEDIA_TYPE__IMAGE = 'IMAGE';
const MEDIA_TYPE__TEXT = 'TEXT';
const MEDIA_TYPE__TEXT_POST = 'TEXT_POST';
const MEDIA_TYPE__VIDEO = 'VIDEO';

const DELETABLE_MEDIA_TYPES = [
    MEDIA_TYPE__TEXT_POST,
    MEDIA_TYPE__IMAGE,
    MEDIA_TYPE__VIDEO,
    MEDIA_TYPE__CAROUSEL_ALBUM,
    MEDIA_TYPE__AUDIO,
];

const PARAMS__ACCESS_TOKEN = 'access_token';
const PARAMS__AFTER = 'after';
const PARAMS__ALT_TEXT = 'alt_text';
const PARAMS__AUTHOR_USERNAME = 'author_username';
const PARAMS__AUTO_PUBLISH_TEXT = 'auto_publish_text';
const PARAMS__BEFORE = 'before';
const PARAMS__CLIENT_ID = 'client_id';
const PARAMS__CONFIG = 'config';
const PARAMS__DELETE_CONFIG = 'delete_config';
const PARAMS__DELETE_QUOTA_USAGE = 'delete_quota_usage';
const PARAMS__FIELDS = 'fields';
const PARAMS__HIDE = 'hide';
const PARAMS__INPUT_TOKEN = 'input_token';
const PARAMS__LIMIT = 'limit';
const PARAMS__LINK_ATTACHMENT = 'link_attachment';
const PARAMS__LOCATION_SEARCH_CONFIG = 'location_search_config';
const PARAMS__LOCATION_SEARCH_QUOTA_USAGE = 'location_search_quota_usage';
const PARAMS__MEDIA_TYPE = 'media_type';
const PARAMS__METRIC = 'metric';
const PARAMS__POLL_ATTACHMENT = 'poll_attachment';
const PARAMS__Q = 'q';
const PARAMS__QUOTA_USAGE = 'quota_usage';
const PARAMS__QUOTE_POST_ID = 'quote_post_id';
const PARAMS__REDIRECT_URI = 'redirect_uri';
const PARAMS__REPLY_CONFIG = 'reply_config';
const PARAMS__REPLY_CONTROL = 'reply_control';
const PARAMS__REPLY_QUOTA_USAGE = 'reply_quota_usage';
const PARAMS__REPLY_TO_ID = 'reply_to_id';
const PARAMS__RESPONSE_TYPE = 'response_type';
const PARAMS__RETURN_URL = 'return_url';
const PARAMS__SCOPE = 'scope';
const PARAMS__SEARCH_MODE = 'search_mode';
const PARAMS__SEARCH_TYPE = 'search_type';
const PARAMS__SINCE = 'since';
const PARAMS__STATE = 'state';
const PARAMS__TEXT = 'text';
const PARAMS__TOPIC_TAG = 'topic_tag';
const PARAMS__UNTIL = 'until';
const PARAMS__USERNAME = 'username';
const PARAMS_IS_SPOILER_MEDIA = 'is_spoiler_media';
const PARAMS_TEXT_ENTITES = 'text_entities';
const PARAMS_IS_GHOST_POST = 'is_ghost_post';

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
    REJECT_UNAUTHORIZED,
} = process.env;

const agent = new https.Agent({
    rejectUnauthorized: REJECT_UNAUTHORIZED !== 'false',
});

const GRAPH_API_BASE_URL =
    'https://graph.threads.com/' +
    (GRAPH_API_VERSION ? GRAPH_API_VERSION + '/' : '');
const AUTHORIZATION_BASE_URL = 'https://www.threads.com';

let initial_access_token = INITIAL_ACCESS_TOKEN;
let initial_user_id = INITIAL_USER_ID;

// Access scopes required for the token
const SCOPES = [
    'threads_basic',
    'threads_content_publish',
    'threads_manage_insights',
    'threads_manage_replies',
    'threads_read_replies',
    'threads_keyword_search',
    'threads_manage_mentions',
    'threads_delete',
    'threads_location_tagging',
    'threads_profile_discovery',
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
            sameSite: 'lax',
        },
    })
);

function matchesSessionToken(expected, received) {
    return (
        typeof expected === 'string' &&
        typeof received === 'string' &&
        /^[a-f0-9]{64}$/.test(expected) &&
        /^[a-f0-9]{64}$/.test(received) &&
        crypto.timingSafeEqual(
            Buffer.from(expected, 'hex'),
            Buffer.from(received, 'hex')
        )
    );
}

app.use(function protectAgainstCsrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        req.session.csrfToken ??= crypto.randomBytes(32).toString('hex');
        res.locals.csrfToken = req.session.csrfToken;
        res.set('Cache-Control', 'no-store');
        return next();
    }

    const headerToken = req.get('X-CSRF-Token');
    const csrfToken =
        headerToken ??
        (req.is('application/x-www-form-urlencoded')
            ? req.body?._csrf
            : undefined);
    if (!matchesSessionToken(req.session.csrfToken, csrfToken)) {
        return res.status(403).json({
            error: true,
            message:
                'The request could not be verified. Reload the page and try again.',
        });
    }
    res.locals.csrfToken = req.session.csrfToken;
    res.set('Cache-Control', 'no-store');
    next();
});

const JSON_TOKEN_PATTERN =
    /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/g;

function parseUserIdResponse(text) {
    const stack = [];
    let previous;
    let field;
    const preserved = text.replace(JSON_TOKEN_PATTERN, (token) => {
        const frame = stack[stack.length - 1];
        let result = token;
        if (token === '{' || token === '[') {
            stack.push({ object: token === '{', keys: new Set() });
        } else if (token === '}' || token === ']') {
            stack.pop();
        } else if (
            token[0] === '"' &&
            frame?.object &&
            (previous === '{' || previous === ',')
        ) {
            field = JSON.parse(token);
            if (frame.keys.has(field))
                throw new Error('Duplicate response field.');
            frame.keys.add(field);
        } else if (
            previous === ':' &&
            field === 'user_id' &&
            /^-?\d/.test(token)
        ) {
            if (!/^[1-9]\d*$/.test(token)) throw new Error('Invalid user ID.');
            result = JSON.stringify(token);
        }
        previous = token;
        return result;
    });
    return JSON.parse(preserved);
}

function isAppScopedUserId(userId) {
    return typeof userId === 'string' && /^[1-9]\d*$/.test(userId);
}

async function verifySessionUserId(req) {
    const binding = req.session.user_id_binding;
    if (
        binding?.access_token === req.session.access_token &&
        binding?.user_id === req.session.user_id
    )
        return true;
    try {
        const response = await axios.get(
            buildGraphAPIURL(
                'debug_token',
                { [PARAMS__INPUT_TOKEN]: req.session.access_token },
                req.session.access_token
            ),
            { httpsAgent: agent, transformResponse: [parseUserIdResponse] }
        );
        const data = response.data?.data;
        if (data?.is_valid !== true || data.user_id !== req.session.user_id)
            return false;
        req.session.user_id_binding = {
            access_token: req.session.access_token,
            user_id: req.session.user_id,
        };
        return true;
    } catch {
        return false;
    }
}

// Middleware to ensure the user is logged in with an app-scoped user ID.
const loggedInUserChecker = (req, res, next) => {
    if (
        !req.session.access_token &&
        initial_access_token &&
        isAppScopedUserId(initial_user_id)
    ) {
        useInitialAuthenticationValues(req);
    }
    if (req.session.access_token && isAppScopedUserId(req.session.user_id)) {
        return next();
    }
    if (req.method !== 'GET') {
        return res.status(401).json({
            error: true,
            message: 'Sign in again to load your Threads app-scoped user ID.',
        });
    }
    if (req.session.access_token) {
        return res.status(401).render('index', {
            title: 'Sign In',
            error: 'Sign in again to load your Threads app-scoped user ID.',
            returnUrl: req.originalUrl,
        });
    }
    const returnUrl = encodeURIComponent(req.originalUrl);
    return res.redirect(`/?${PARAMS__RETURN_URL}=${returnUrl}`);
};

app.get('/', async (req, res) => {
    if (
        !req.session.access_token &&
        initial_access_token &&
        isAppScopedUserId(initial_user_id)
    ) {
        useInitialAuthenticationValues(req);
        res.redirect('/account');
    } else {
        res.render('index', {
            title: 'Home',
            returnUrl: req.query[PARAMS__RETURN_URL],
        });
    }
});

// Store single-use OAuth state outside snapshots saved by concurrent requests.
const oauthStates = new Map();
const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;

function clearOAuthState(sessionID) {
    const record = oauthStates.get(sessionID);
    if (record) clearTimeout(record.timer);
    oauthStates.delete(sessionID);
}

function createOAuthState(sessionID) {
    clearOAuthState(sessionID);
    const record = {
        value: crypto.randomBytes(32).toString('hex'),
        expiresAt: Date.now() + OAUTH_STATE_LIFETIME_MS,
    };
    record.timer = setTimeout(() => {
        if (oauthStates.get(sessionID) === record)
            oauthStates.delete(sessionID);
    }, OAUTH_STATE_LIFETIME_MS);
    record.timer.unref();
    oauthStates.set(sessionID, record);
    return record.value;
}

function consumeOAuthState(req, state) {
    const record = oauthStates.get(req.sessionID);
    if (
        !record ||
        record.expiresAt <= Date.now() ||
        !matchesSessionToken(record.value, state)
    )
        return false;
    clearOAuthState(req.sessionID);
    return true;
}

const signInRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
        return res.status(options.statusCode).render('index', {
            title: 'Sign In',
            error: 'Too many sign-in requests. Wait a minute and try again.',
        });
    },
});

// Start OAuth with a state value bound to this browser session.
app.get('/login', signInRateLimit, (req, res) => {
    if (req.method !== 'GET') return res.sendStatus(405);
    const state = createOAuthState(req.sessionID);
    const url = buildGraphAPIURL(
        'oauth/authorize',
        {
            [PARAMS__SCOPE]: SCOPES.join(','),
            [PARAMS__CLIENT_ID]: APP_ID,
            [PARAMS__REDIRECT_URI]: REDIRECT_URI,
            [PARAMS__RESPONSE_TYPE]: 'code',
            [PARAMS__STATE]: state,
        },
        null,
        AUTHORIZATION_BASE_URL
    );
    res.redirect(url);
});

// Verify the OAuth callback before exchanging the authorization code.
app.get('/callback', signInRateLimit, async (req, res) => {
    if (req.method !== 'GET') return res.sendStatus(405);
    const code = req.query.code;
    const uri = buildGraphAPIURL(
        'oauth/access_token',
        {},
        null,
        GRAPH_API_BASE_URL
    );

    try {
        if (!consumeOAuthState(req, req.query[PARAMS__STATE])) {
            return res.status(403).render('index', {
                title: 'Sign In',
                error: 'The sign-in request could not be verified. Start sign-in again.',
            });
        }
        if (typeof code !== 'string' || !code) {
            return res.status(400).render('index', {
                title: 'Sign In',
                error: 'No authorization code was returned. Start sign-in again.',
            });
        }
        const response = await axios.post(
            uri,
            new URLSearchParams({
                client_id: APP_ID,
                client_secret: API_SECRET,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI,
                code,
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                httpsAgent: agent,
                transformResponse: [parseUserIdResponse],
            }
        );
        if (
            typeof response.data?.access_token !== 'string' ||
            !response.data.access_token ||
            !isAppScopedUserId(response.data.user_id)
        ) {
            return res.status(502).render('index', {
                title: 'Sign In',
                error: 'The sign-in response did not include a Threads app-scoped user ID. Try signing in again.',
            });
        }
        req.session.access_token = response.data.access_token;
        req.session.user_id = response.data.user_id;
        req.session.user_id_binding = {
            access_token: req.session.access_token,
            user_id: req.session.user_id,
        };
        const extendAccessTokenUrl = buildGraphAPIURL(
            `access_token`,
            {
                grant_type: 'th_exchange_token',
                client_secret: API_SECRET,
            },
            req.session.access_token
        );
        try {
            const extendTokenResponse = await axios.get(extendAccessTokenUrl, {
                httpsAgent: agent,
            });
            const extendedToken = extendTokenResponse.data?.access_token;
            if (typeof extendedToken === 'string' && extendedToken) {
                req.session.access_token = extendedToken;
            }
        } catch (e) {
            console.error(e?.response?.data?.error?.message ?? e.message);
        }
        req.session.user_id_binding = {
            access_token: req.session.access_token,
            user_id: req.session.user_id,
        };
        res.redirect('/account');
    } catch (err) {
        console.error('Unable to complete Threads sign-in.');
        res.status(502).render('index', {
            title: 'Sign In',
            error: 'Unable to complete Threads sign-in. Try again.',
        });
    }
});

app.get('/account', loggedInUserChecker, async (req, res) => {
    const getUserDetailsUrl = buildGraphAPIURL(
        req.session.user_id,
        {
            [PARAMS__FIELDS]: [
                FIELD__USERNAME,
                FIELD__NAME,
                FIELD__THREADS_PROFILE_PICTURE_URL,
                FIELD__THREADS_BIOGRAPHY,
                FIELD__IS_VERIFIED,
            ].join(','),
        },
        req.session.access_token
    );

    let userDetails = {};
    try {
        const response = await axios.get(getUserDetailsUrl, {
            httpsAgent: agent,
        });
        userDetails = response.data;

        userDetails.user_profile_url = `https://www.threads.com/@${userDetails.username}`;
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
    const minDate = DateTime.utc().minus({ years: 2 }).toISODate();
    let filterError;
    for (const value of [since, until]) {
        if (value === undefined || value === '') continue;
        if (
            typeof value !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !DateTime.fromISO(value, { zone: 'utc' }).isValid
        ) {
            filterError = 'Enter valid dates in YYYY-MM-DD format.';
            break;
        }
        if (value < minDate) {
            filterError = `Choose dates on or after ${minDate}.`;
            break;
        }
    }
    if (!filterError && since && until && since > until) {
        filterError = 'Since must be on or before Until.';
    }
    if (filterError) {
        return res.status(400).render('user_insights', {
            title: 'User Insights',
            metrics: [],
            since: typeof since === 'string' ? since : undefined,
            until: typeof until === 'string' ? until : undefined,
            minDate,
            error: filterError,
        });
    }

    const params = {
        [PARAMS__METRIC]: [
            FIELD__VIEWS,
            FIELD__LIKES,
            FIELD__REPLIES,
            FIELD__QUOTES,
            FIELD__REPOSTS,
            FIELD__CLICKS,
            FIELD__FOLLOWERS_COUNT,
        ].join(','),
    };
    if (since) {
        params.since = since;
    }
    if (until) {
        params.until = until;
    }

    const queryThreadUrl = buildGraphAPIURL(
        `${req.session.user_id}/threads_insights`,
        params,
        req.session.access_token
    );

    let data = [];
    try {
        const queryResponse = await axios.get(queryThreadUrl, {
            httpsAgent: agent,
        });
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
        } else if (metric.name === FIELD__CLICKS) {
            getInsightsValueForClicks(metrics, index);
        } else {
            // All other metrics return as a total value
            getInsightsTotalValue(metrics, index);
        }
    }

    res.render('user_insights', {
        title: 'User Insights',
        metrics,
        since,
        until,
        minDate,
    });
});

app.get('/publishingLimit', loggedInUserChecker, async (req, res) => {
    const params = {
        [PARAMS__FIELDS]: [
            PARAMS__QUOTA_USAGE,
            PARAMS__CONFIG,
            PARAMS__REPLY_QUOTA_USAGE,
            PARAMS__REPLY_CONFIG,
            PARAMS__DELETE_QUOTA_USAGE,
            PARAMS__DELETE_CONFIG,
            PARAMS__LOCATION_SEARCH_QUOTA_USAGE,
            PARAMS__LOCATION_SEARCH_CONFIG,
        ].join(','),
    };

    const publishingLimitUrl = buildGraphAPIURL(
        `${req.session.user_id}/threads_publishing_limit`,
        params,
        req.session.access_token
    );

    let data = [];
    try {
        const queryResponse = await axios.get(publishingLimitUrl, {
            httpsAgent: agent,
        });
        data = queryResponse.data;
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    data = data.data?.[0] ?? {};

    const quotaUsage = data[PARAMS__QUOTA_USAGE];
    const config = data[PARAMS__CONFIG];
    const replyQuotaUsage = data[PARAMS__REPLY_QUOTA_USAGE];
    const replyConfig = data[PARAMS__REPLY_CONFIG];
    const deleteQuotaUsage = data[PARAMS__DELETE_QUOTA_USAGE];
    const deleteConfig = data[PARAMS__DELETE_CONFIG];
    const locationSearchQuotaUsage = data[PARAMS__LOCATION_SEARCH_QUOTA_USAGE];
    const locationSearchConfig = data[PARAMS__LOCATION_SEARCH_CONFIG];

    res.render('publishing_limit', {
        title: 'Publishing Limit',
        quotaUsage,
        config,
        replyQuotaUsage,
        replyConfig,
        deleteQuotaUsage,
        deleteConfig,
        locationSearchQuotaUsage,
        locationSearchConfig,
    });
});

app.get('/upload', loggedInUserChecker, (req, res) => {
    const { replyToId: replyToID, quotePostId: quotePostID } = req.query;
    let title = 'Upload';
    if (replyToID !== undefined) title = 'Upload (Reply)';
    else if (quotePostID) title = 'Upload (Quote)';
    res.render('upload', {
        title,
        replyToId: replyToID,
        quotePostId: quotePostID,
    });
});

app.post('/repost', upload.array(), async (req, res) => {
    const { repostId } = req.body;

    const repostThreadsUrl = buildGraphAPIURL(
        `${repostId}/repost`,
        {},
        req.session.access_token
    );
    try {
        const repostResponse = await axios.post(repostThreadsUrl, {});
        const containerId = repostResponse.data.id;
        return res.redirect(`threads/${containerId}`);
    } catch (e) {
        console.error(e.message);
        return res.json({
            error: true,
            message: `Error during repost: ${e}`,
        });
    }
});

const publishingRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
        res.status(options.statusCode).json({
            error: true,
            message:
                'Too many publishing requests. Wait a minute and try again.',
        });
    },
});

app.post(
    '/upload',
    publishingRateLimit,
    loggedInUserChecker,
    upload.array(),
    async (req, res) => {
        const {
            text,
            attachmentType,
            attachmentUrl,
            attachmentAltText,
            replyControl,
            replyToId,
            topicTag,
            linkAttachment,
            autoPublishText,
            pollOptionA,
            pollOptionB,
            pollOptionC,
            pollOptionD,
            quotePostId,
            spoilerMedia,
            ghostPostMedia,
        } = req.body;

        const params = {
            [PARAMS__REPLY_CONTROL]: replyControl,
            [PARAMS__REPLY_TO_ID]: replyToId,
            [PARAMS__LINK_ATTACHMENT]: linkAttachment,
        };

        if (text.includes(spoilerMarker)) {
            parsedInput = textParser.extractSpoilerInfo(text);
            processedText = parsedInput.text;
            textEntites = parsedInput.textEntities;
            params[PARAMS__TEXT] = processedText;
            params[PARAMS_TEXT_ENTITES] = JSON.stringify(textEntites);
        } else {
            params[PARAMS__TEXT] = text;
        }
        if (
            topicTag.length >= 1 &&
            topicTag.length <= 50 &&
            !topicTag.includes('.') &&
            !topicTag.includes('&')
        ) {
            params[PARAMS__TOPIC_TAG] = topicTag;
        }

        if (spoilerMedia) {
            params[PARAMS_IS_SPOILER_MEDIA] = true;
        }

        if (ghostPostMedia) {
            params[PARAMS_IS_GHOST_POST] = true;
        }

        if (pollOptionA && pollOptionB) {
            const pollAttachment = JSON.stringify({
                option_a: pollOptionA,
                option_b: pollOptionB,
                option_c: pollOptionC,
                option_d: pollOptionD,
            });
            params[PARAMS__POLL_ATTACHMENT] = pollAttachment;
        }

        if (quotePostId) {
            params[PARAMS__QUOTE_POST_ID] = quotePostId;
        }

        // No attachments
        if (!attachmentType?.length) {
            params.media_type = MEDIA_TYPE__TEXT;
        }
        // Single attachment
        else if (attachmentType?.length === 1) {
            addAttachmentFields(
                params,
                attachmentType[0],
                attachmentUrl[0],
                attachmentAltText[0]
            );
        }
        // Multiple attachments
        else {
            params.media_type = MEDIA_TYPE__CAROUSEL;
            params.children = [];
            attachmentType.forEach((type, i) => {
                const child = {
                    is_carousel_item: true,
                };
                addAttachmentFields(
                    child,
                    type,
                    attachmentUrl[i],
                    attachmentAltText[i]
                );
                params.children.push(child);
            });
        }

        if (
            autoPublishText === 'on' &&
            params.media_type === MEDIA_TYPE__TEXT
        ) {
            params[PARAMS__AUTO_PUBLISH_TEXT] = true;
        }

        if (params.media_type === MEDIA_TYPE__CAROUSEL) {
            const createChildPromises = params.children.map((child) =>
                axios.post(
                    buildGraphAPIURL(
                        `${req.session.user_id}/threads`,
                        child,
                        req.session.access_token
                    ),
                    {}
                )
            );
            try {
                const createCarouselItemResponse = await Promise.all(
                    createChildPromises
                );
                // Replace children with the IDs
                params.children = createCarouselItemResponse
                    .filter((response) => response.status === 200)
                    .map((response) => response.data.id)
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

        const postThreadsUrl = buildGraphAPIURL(
            `${req.session.user_id}/threads`,
            params,
            req.session.access_token
        );
        try {
            const postResponse = await axios.post(
                postThreadsUrl,
                {},
                { httpsAgent: agent }
            );
            const id = postResponse.data.id;
            if (
                autoPublishText === 'on' &&
                params.media_type === MEDIA_TYPE__TEXT
            ) {
                // If auto_publish_text is on, the returned ID is the published Threads ID.
                return res.json({
                    redirectUrl: `/threads/${id}`,
                });
            } else {
                // Otherwise, the returned ID is the container ID.
                return res.json({
                    id: id,
                });
            }
        } catch (e) {
            console.error(e.message);
            res.json({
                error: true,
                message: `Error during upload: ${e}`,
            });
        }
    }
);

app.get('/publish/:containerId', loggedInUserChecker, async (req, res) => {
    const containerId = req.params.containerId;
    res.render('publish', {
        containerId,
        title: 'Publish',
    });
});

app.get(
    '/container/status/:containerId',
    loggedInUserChecker,
    async (req, res) => {
        const { containerId } = req.params;
        const getContainerStatusUrl = buildGraphAPIURL(
            containerId,
            {
                [PARAMS__FIELDS]: [FIELD__STATUS, FIELD__ERROR_MESSAGE].join(
                    ','
                ),
            },
            req.session.access_token
        );

        try {
            const queryResponse = await axios.get(getContainerStatusUrl, {
                httpsAgent: agent,
            });
            res.json(queryResponse.data);
        } catch (e) {
            console.error(e.message);
            res.json({
                error: true,
                message: `Error querying container status: ${e}`,
            });
        }
    }
);

app.post(
    '/publish',
    publishingRateLimit,
    loggedInUserChecker,
    upload.array(),
    async (req, res) => {
        const { containerId } = req.body;
        const publishThreadsUrl = buildGraphAPIURL(
            `${req.session.user_id}/threads_publish`,
            {
                creation_id: containerId,
            },
            req.session.access_token
        );

        try {
            const postResponse = await axios.post(publishThreadsUrl, {
                httpsAgent: agent,
            });
            const threadId = postResponse.data.id;
            res.json({
                id: threadId,
            });
        } catch (e) {
            console.error(e.message);
            res.json({
                error: true,
                message: `Error during publishing: ${e}`,
            });
        }
    }
);

function hasDisplayValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
}

function isWebUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function formatPostTimestamp(timestamp) {
    if (typeof timestamp !== 'string' || timestamp.trim() === '')
        return timestamp;
    const date = DateTime.fromISO(timestamp, { zone: 'utc', setZone: true });
    return date.isValid
        ? date
              .toUTC()
              .setLocale('en')
              .toFormat("LLLL d, yyyy 'at' h:mm a 'UTC'")
        : timestamp;
}

function getPostTimestampISO(timestamp) {
    if (typeof timestamp !== 'string' || timestamp.trim() === '')
        return undefined;
    const date = DateTime.fromISO(timestamp, { zone: 'utc', setZone: true });
    return date.isValid ? date.toUTC().toISO() : undefined;
}

app.locals.formatPostTimestamp = formatPostTimestamp;
app.locals.getPostTimestampISO = getPostTimestampISO;

const postDetailsRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
        res.status(options.statusCode).render('error', {
            title: 'Post Details',
            error: 'Too many post detail requests. Wait a minute and try again.',
        });
    },
});

app.get(
    '/threads/:threadId',
    postDetailsRateLimit,
    loggedInUserChecker,
    async (req, res) => {
        const { threadId } = req.params;
        if (!/^\d+$/.test(threadId)) {
            return res.status(400).render('error', {
                title: 'Thread',
                error: 'The post ID is invalid.',
            });
        }
        let data = {};
        let postLoaded = false;
        let canDelete = false;
        let error;
        const queryThreadUrl = buildGraphAPIURL(
            `${threadId}`,
            {
                [PARAMS__FIELDS]: [
                    FIELD__TEXT,
                    FIELD__MEDIA_TYPE,
                    FIELD__MEDIA_URL,
                    FIELD__GIF_URL,
                    FIELD__PERMALINK,
                    FIELD__TIMESTAMP,
                    FIELD__IS_REPLY,
                    FIELD__USERNAME,
                    FIELD__REPLY_AUDIENCE,
                    FIELD__ALT_TEXT,
                    FIELD__LINK_ATTACHMENT_URL,
                    FIELD__TOPIC_TAG,
                    FIELD__POLL_ATTACHMENT,
                    FIELD__IS_QUOTE_POST,
                    FIELD__QUOTED_POST,
                    FIELD__REPOSTED_POST,
                    FIELD_IS_SPOILER_MEDIA,
                    FIELD_TEXT_ENTITES,
                    FIELD_GHOST_POST_STATUS,
                ].join(','),
            },
            req.session.access_token
        );

        try {
            const queryResponse = await axios.get(queryThreadUrl, {
                httpsAgent: agent,
            });
            if (
                !queryResponse.data ||
                typeof queryResponse.data !== 'object' ||
                Array.isArray(queryResponse.data) ||
                !hasDisplayValue(queryResponse.data)
            ) {
                throw new Error('The API returned an empty or invalid post.');
            }
            const { poll_attachment, ghost_post_status, ...rest } =
                queryResponse.data;
            data = rest;

            if (poll_attachment) {
                data = {
                    ...data,
                    ...poll_attachment,
                };
            }

            const is_ghost_post = hasDisplayValue(ghost_post_status)
                ? ghost_post_status === 'ACTIVE'
                : undefined;
            data = {
                ...data,
                is_ghost_post,
            };
            postLoaded = true;
        } catch (e) {
            error = e?.response?.data?.error?.message ?? e.message;
            console.error(error);
        }

        if (DELETABLE_MEDIA_TYPES.includes(data.media_type)) {
            try {
                if (!(await verifySessionUserId(req))) {
                    throw new Error(
                        'The access token does not match the app-scoped user ID.'
                    );
                }
                const userUrl = buildGraphAPIURL(
                    req.session.user_id,
                    { [PARAMS__FIELDS]: FIELD__ID },
                    req.session.access_token
                );
                const userResponse = await axios.get(userUrl, {
                    httpsAgent: agent,
                });
                const ownerUrl = buildGraphAPIURL(
                    threadId,
                    {
                        [PARAMS__FIELDS]: [
                            FIELD__ID,
                            FIELD__MEDIA_TYPE,
                            FIELD__OWNER,
                        ].join(','),
                    },
                    req.session.access_token
                );
                const ownerResponse = await axios.get(ownerUrl, {
                    httpsAgent: agent,
                });
                canDelete =
                    userResponse.data.id === req.session.user_id &&
                    ownerResponse.data.id === threadId &&
                    ownerResponse.data.owner?.id === userResponse.data.id &&
                    DELETABLE_MEDIA_TYPES.includes(
                        ownerResponse.data.media_type
                    );
                if (canDelete && !req.session.deleteCsrfToken) {
                    req.session.deleteCsrfToken = crypto
                        .randomBytes(32)
                        .toString('hex');
                }
            } catch (e) {
                canDelete = false;
                console.error(e?.response?.data?.error?.message ?? e.message);
            }
        }

        res.render('thread', {
            threadId,
            ...data,
            canDelete,
            deleteCsrfToken: canDelete
                ? req.session.deleteCsrfToken
                : undefined,
            error,
            hasDisplayValue,
            isWebUrl,
            creationDateTime: formatPostTimestamp(data.timestamp),
            postLoaded,
            title: 'Post Details',
        });
    }
);

app.get('/threads', loggedInUserChecker, async (req, res) => {
    const { before, after, limit } = req.query;
    if (!req.session.deleteCsrfToken) {
        req.session.deleteCsrfToken = crypto.randomBytes(32).toString('hex');
    }
    const params = {
        [PARAMS__FIELDS]: [
            FIELD__TEXT,
            FIELD__MEDIA_TYPE,
            FIELD__MEDIA_URL,
            FIELD__PERMALINK,
            FIELD__TIMESTAMP,
            FIELD__USERNAME,
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

    const queryThreadsUrl = buildGraphAPIURL(
        `${req.session.user_id}/threads`,
        params,
        req.session.access_token
    );

    try {
        const queryResponse = await axios.get(queryThreadsUrl, {
            httpsAgent: agent,
        });
        threads = queryResponse.data.data;

        if (queryResponse.data.paging) {
            const { next, previous } = queryResponse.data.paging;

            if (next) {
                paging.nextUrl = getCursorUrlFromGraphApiPagingUrl(req, next);
            }

            if (previous) {
                paging.previousUrl = getCursorUrlFromGraphApiPagingUrl(
                    req,
                    previous
                );
            }
        }
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    res.render('threads', {
        paging,
        threads,
        canDelete: true,
        deletableMediaTypes: DELETABLE_MEDIA_TYPES,
        deleteCsrfToken: req.session.deleteCsrfToken,
        title: 'Threads',
    });
});

const deleteRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
        res.status(options.statusCode).render('error', {
            title: 'Delete Post',
            error: 'Too many delete requests. Wait a minute and try again.',
        });
    },
});

app.post(
    '/threads/:threadId/delete',
    deleteRateLimit,
    loggedInUserChecker,
    upload.array(),
    async (req, res) => {
        const { threadId } = req.params;
        const title = 'Delete Post';
        if (!/^\d+$/.test(threadId)) {
            return res.status(400).render('error', {
                title,
                error: 'The post ID is invalid.',
            });
        }
        if (
            !req.session.deleteCsrfToken ||
            typeof req.body.csrfToken !== 'string' ||
            req.body.csrfToken !== req.session.deleteCsrfToken
        ) {
            return res.status(403).render('error', {
                title,
                error: 'The request could not be verified. Open your posts and try again.',
            });
        }

        try {
            if (!(await verifySessionUserId(req))) {
                return res.status(403).render('error', {
                    title,
                    error: 'The access token does not match the app-scoped user ID. Sign in again.',
                });
            }
            const userUrl = buildGraphAPIURL(
                req.session.user_id,
                { [PARAMS__FIELDS]: FIELD__ID },
                req.session.access_token
            );
            const userResponse = await axios.get(userUrl, {
                httpsAgent: agent,
            });
            const postUrl = buildGraphAPIURL(
                threadId,
                {
                    [PARAMS__FIELDS]: [
                        FIELD__ID,
                        FIELD__MEDIA_TYPE,
                        FIELD__OWNER,
                    ].join(','),
                },
                req.session.access_token
            );
            const postResponse = await axios.get(postUrl, {
                httpsAgent: agent,
            });
            if (!DELETABLE_MEDIA_TYPES.includes(postResponse.data.media_type)) {
                return res.status(403).render('error', {
                    title,
                    error: 'This post type is not supported for deletion in this sample.',
                });
            }
            if (
                userResponse.data.id !== req.session.user_id ||
                postResponse.data.id !== threadId ||
                postResponse.data.owner?.id !== userResponse.data.id
            ) {
                return res.status(403).render('error', {
                    title,
                    error: 'This post cannot be deleted. Choose one of your posts on the Threads page.',
                });
            }

            const deleteUrl = buildGraphAPIURL(
                threadId,
                {},
                req.session.access_token
            );
            const response = await axios.delete(deleteUrl, {
                httpsAgent: agent,
            });
            if (
                response.data.success !== true ||
                response.data.deleted_id !== threadId
            ) {
                return res.status(502).render('error', {
                    title,
                    error: 'Deletion was not confirmed. Refresh your posts before trying again.',
                });
            }
            return res.redirect(303, '/threads');
        } catch (e) {
            const error =
                e?.response?.data?.error?.message ??
                'Unable to confirm deletion. Refresh your posts before trying again.';
            console.error(error);
            return res.status(502).render('error', { title, error });
        }
    }
);

app.get('/replies', loggedInUserChecker, async (req, res) => {
    const { before, after, limit } = req.query;
    const params = {
        [PARAMS__FIELDS]: [
            FIELD__TEXT,
            FIELD__MEDIA_TYPE,
            FIELD__MEDIA_URL,
            FIELD__PERMALINK,
            FIELD__TIMESTAMP,
            FIELD__USERNAME,
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

    const queryRepliesUrl = buildGraphAPIURL(
        `${req.session.user_id}/replies`,
        params,
        req.session.access_token
    );

    try {
        const queryResponse = await axios.get(queryRepliesUrl, {
            httpsAgent: agent,
        });
        threads = queryResponse.data.data;

        if (queryResponse.data.paging) {
            const { next, previous } = queryResponse.data.paging;

            if (next) {
                paging.nextUrl = getCursorUrlFromGraphApiPagingUrl(req, next);
            }

            if (previous) {
                paging.previousUrl = getCursorUrlFromGraphApiPagingUrl(
                    req,
                    previous
                );
            }
        }
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    res.render('threads', {
        paging,
        threads,
        title: 'My Replies',
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

    const hideReplyUrl = buildGraphAPIURL(
        `${replyId}/manage_reply`,
        {},
        req.session.access_token
    );

    try {
        response = await axios.post(hideReplyUrl, params, {
            httpsAgent: agent,
        });
    } catch (e) {
        console.error(e?.message);
        return res.status(e?.response?.status ?? 500).json({
            error: true,
            message: `Error while hiding reply: ${e}`,
        });
    }

    return res.sendStatus(200);
});

app.get(
    '/threads/:threadId/insights',
    loggedInUserChecker,
    async (req, res) => {
        const { threadId } = req.params;
        const { since, until } = req.query;

        const params = {
            [PARAMS__METRIC]: [
                FIELD__VIEWS,
                FIELD__LIKES,
                FIELD__REPLIES,
                FIELD__REPOSTS,
                FIELD__QUOTES,
                FIELD__SHARES,
            ].join(','),
        };
        if (since) {
            params.since = since;
        }
        if (until) {
            params.until = until;
        }

        const queryThreadUrl = buildGraphAPIURL(
            `${threadId}/insights`,
            params,
            req.session.access_token
        );

        let data = [];
        try {
            const queryResponse = await axios.get(queryThreadUrl, {
                httpsAgent: agent,
            });
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
    }
);

app.get('/mentions', loggedInUserChecker, async (req, res) => {
    const { before, after, limit } = req.query;
    const params = {
        [PARAMS__FIELDS]: [
            FIELD__USERNAME,
            FIELD__TEXT,
            FIELD__MEDIA_TYPE,
            FIELD__MEDIA_URL,
            FIELD__PERMALINK,
            FIELD__TIMESTAMP,
        ].join(','),
        limit: limit ?? DEFAULT_THREADS_QUERY_LIMIT,
    };
    if (before) {
        params.before = before;
    }
    if (after) {
        params.after = after;
    }

    const queryMentionsUrl = buildGraphAPIURL(
        `${req.session.user_id}/mentions`,
        params,
        req.session.access_token
    );

    let threads = [];
    let paging = {};

    try {
        const queryResponse = await axios.get(queryMentionsUrl, {
            httpsAgent: agent,
        });
        threads = queryResponse.data.data;

        if (queryResponse.data.paging) {
            const { next, previous } = queryResponse.data.paging;

            if (next) {
                paging.nextUrl = getCursorUrlFromGraphApiPagingUrl(req, next);
            }

            if (previous) {
                paging.previousUrl = getCursorUrlFromGraphApiPagingUrl(
                    req,
                    previous
                );
            }
        }
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    res.render('mentions', {
        title: 'Mentions',
        threads,
        paging,
    });
});

app.get('/debug', loggedInUserChecker, async (req, res) => {
    const params = {
        [PARAMS__INPUT_TOKEN]: req.session.access_token,
    };

    const debugAccessTokenUrl = buildGraphAPIURL(
        `debug_token`,
        params,
        req.session.access_token
    );

    try {
        const response = await axios.get(debugAccessTokenUrl, {
            httpsAgent: agent,
            transformResponse: [parseUserIdResponse],
        });
        const data = response.data?.data;
        if (
            !isAppScopedUserId(data?.[FIELD__APP_SCOPED_USER_ID]) ||
            !Array.isArray(data[FIELD__SCOPES]) ||
            !data[FIELD__SCOPES].every((scope) => typeof scope === 'string') ||
            !Number.isFinite(data[FIELD__EXPIRES_AT]) ||
            !Number.isFinite(data[FIELD__ISSUED_AT])
        ) {
            throw new Error('Invalid token metadata.');
        }
        return res.render('debug', {
            title: 'Inspect Access Token',
            applicationName: data[FIELD__APPLICATION],
            expiresAt: formatTimestamp(data[FIELD__EXPIRES_AT]),
            expiresAtISO: DateTime.fromSeconds(data[FIELD__EXPIRES_AT], {
                zone: 'utc',
            }).toISO(),
            issuedAt: formatTimestamp(data[FIELD__ISSUED_AT]),
            issuedAtISO: DateTime.fromSeconds(data[FIELD__ISSUED_AT], {
                zone: 'utc',
            }).toISO(),
            permissions: data[FIELD__SCOPES],
            appScopedUserId: data[FIELD__APP_SCOPED_USER_ID],
        });
    } catch {
        return res.status(502).render('debug', {
            title: 'Inspect Access Token',
            error: 'Unable to inspect the access token. Try again.',
        });
    }
});

app.get('/keywordSearch', loggedInUserChecker, async (req, res) => {
    const { keyword, searchType = 'TOP', before, after, limit } = req.query;
    const { searchMode = 'KEYWORD', since, until } = req.query;
    const { mediaType = '', authorUsername = '' } = req.query;
    const author =
        typeof authorUsername === 'string' ? authorUsername.trim() : '';
    const mediaAuthorFilters = { mediaType, authorUsername: author };
    const hasLimit =
        limit !== undefined &&
        (typeof limit !== 'string' || limit.trim() !== '');
    const pageSize =
        hasLimit && typeof limit === 'string' ? Number(limit) : undefined;
    let filterError;
    if (
        !['', MEDIA_TYPE__TEXT, MEDIA_TYPE__IMAGE, MEDIA_TYPE__VIDEO].includes(
            mediaType
        )
    ) {
        filterError = 'Choose All Media Types, Text, Image or Video.';
    } else if (typeof authorUsername !== 'string' || author.includes('@')) {
        filterError = 'Enter an author username without the @ symbol.';
    }
    if (filterError) {
        return res.status(400).render('keyword_search', {
            title: 'Search for Threads',
            ...mediaAuthorFilters,
            keyword,
            searchType,
            searchMode,
            since: typeof since === 'string' ? since : undefined,
            until: typeof until === 'string' ? until : undefined,
            limit: typeof limit === 'string' ? limit : undefined,
            error: filterError,
        });
    }

    if (!['KEYWORD', 'TAG'].includes(searchMode)) {
        return res.status(400).render('keyword_search', {
            title: 'Search for Threads',
            ...mediaAuthorFilters,
            keyword,
            searchType,
            searchMode,
            since: typeof since === 'string' ? since : undefined,
            until: typeof until === 'string' ? until : undefined,
            limit: typeof limit === 'string' ? limit : undefined,
            error: 'Choose Keyword or Topic Tag for the search mode.',
        });
    }
    if (
        hasLimit &&
        (typeof limit !== 'string' ||
            !Number.isInteger(pageSize) ||
            pageSize < 0 ||
            pageSize > 100)
    ) {
        return res.status(400).render('keyword_search', {
            title: 'Search for Threads',
            ...mediaAuthorFilters,
            keyword,
            searchType,
            searchMode,
            since: typeof since === 'string' ? since : undefined,
            until: typeof until === 'string' ? until : undefined,
            limit: typeof limit === 'string' ? limit : undefined,
            error: 'Page size must be a whole number from 0 to 100.',
        });
    }
    if (
        (since !== undefined && typeof since !== 'string') ||
        (until !== undefined && typeof until !== 'string')
    ) {
        return res.status(400).render('keyword_search', {
            title: 'Search for Threads',
            ...mediaAuthorFilters,
            keyword,
            searchType,
            searchMode,
            limit: pageSize,
            error: 'Use a date or Unix timestamp for Since and Until.',
        });
    }

    if (!keyword) {
        return res.render('keyword_search', {
            title: 'Search for Threads',
            ...mediaAuthorFilters,
            searchMode,
            searchType,
            since,
            until,
            limit: pageSize,
        });
    }

    const params = {
        [PARAMS__Q]: keyword,
        [PARAMS__SEARCH_MODE]: searchMode,
        [PARAMS__SEARCH_TYPE]: searchType,
        [PARAMS__FIELDS]: [
            FIELD__USERNAME,
            FIELD__ID,
            FIELD__TIMESTAMP,
            FIELD__MEDIA_TYPE,
            FIELD__TOPIC_TAG,
            FIELD__TEXT,
            FIELD__PERMALINK,
            FIELD__MEDIA_URL,
        ].join(','),
    };

    if (before) {
        params[PARAMS__BEFORE] = before;
    }
    if (after) {
        params[PARAMS__AFTER] = after;
    }
    if (hasLimit) {
        params[PARAMS__LIMIT] = pageSize;
    }
    if (since && since.trim()) {
        params[PARAMS__SINCE] = since.trim();
    }
    if (until && until.trim()) {
        params[PARAMS__UNTIL] = until.trim();
    }
    if (mediaType) {
        params[PARAMS__MEDIA_TYPE] = mediaType;
    }
    if (author) {
        params[PARAMS__AUTHOR_USERNAME] = author;
    }

    const keywordSearchUrl = buildGraphAPIURL(
        `keyword_search`,
        params,
        req.session.access_token
    );

    let threads = [];
    let paging = {};

    try {
        const response = await axios.get(keywordSearchUrl, {
            httpsAgent: agent,
        });
        threads = response.data.data;

        if (response.data.paging) {
            const { next, previous } = response.data.paging;

            if (next) {
                paging.nextUrl = getCursorUrlFromGraphApiPagingUrl(req, next);
            }
            if (previous) {
                paging.previousUrl = getCursorUrlFromGraphApiPagingUrl(
                    req,
                    previous
                );
            }
        }
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
        return res.render('keyword_search', {
            title: 'Search for Threads',
            ...mediaAuthorFilters,
            keyword,
            searchType,
            searchMode,
            since,
            until,
            limit: pageSize,
            error: e?.response?.data?.error?.message ?? e.message,
        });
    }

    const resultTypeLabel = searchType === 'RECENT' ? 'Recent' : 'Top';
    return res.render('keyword_search', {
        title: 'Search for Threads',
        ...mediaAuthorFilters,
        keyword,
        searchType,
        searchMode,
        since,
        until,
        limit: pageSize,
        threads,
        paging,
        formatPostTimestamp,
        resultsTitle: `${resultTypeLabel} ${
            searchMode === 'TAG' ? 'Topic Tag' : 'Keyword'
        } Results for '${keyword}'`,
    });
});

const logoutRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
        return res.status(options.statusCode).json({
            error: true,
            message: 'Too many sign-out requests. Wait a minute and try again.',
        });
    },
});

// Logout route to destroy the authenticated session.
app.post('/logout', logoutRateLimit, (req, res) => {
    clearOAuthState(req.sessionID);
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).render('index', {
                title: 'Home',
                error: 'Unable to log out.',
            });
        }
        res.clearCookie('connect.sid', { sameSite: 'lax' });
        delete res.locals.csrfToken;
        res.render('index', { title: 'Home', message: 'Logged out.' });
    });
});

app.get('/oEmbed', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.render('oembed', {
            title: 'Embed Threads',
        });
    }

    const oEmbedUrl = buildGraphAPIURL(`oembed`, {
        url,
    });

    let html = '<p>Unable to embed</p>';
    try {
        const response = await axios.get(oEmbedUrl, { httpsAgent: agent });
        if (response.data?.html) {
            html = response.data.html;
        }
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    return res.render('oembed', {
        title: 'Embed Threads',
        html,
        url,
    });
});

app.get('/profileLookup', async (req, res) => {
    const { username, before, after, limit } = req.query;
    if (!username) {
        return res.render('profile_lookup', {
            title: 'Profile Lookup',
        });
    }

    const params = {
        [PARAMS__USERNAME]: username,
    };

    const profileLookupUrl = buildGraphAPIURL(
        `profile_lookup`,
        params,
        req.session.access_token
    );

    let response = {};
    try {
        response = await axios.get(profileLookupUrl, { httpsAgent: agent });
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    const displayName = response.data?.name;
    const profilePictureUrl = response.data?.profile_picture_url;
    const isVerified = response.data?.is_verified;
    const bio = response.data?.biography;
    const formatCount = (count) =>
        count ? count.toLocaleString('en-US') : undefined;
    const followerCount = formatCount(response.data?.follower_count);
    const likesCount = formatCount(response.data?.likes_count);
    const quotesCount = formatCount(response.data?.quotes_count);
    const repliesCount = formatCount(response.data?.replies_count);
    const repostsCount = formatCount(response.data?.reposts_count);
    const viewsCount = formatCount(response.data?.views_count);

    const profilePostsParams = {
        [PARAMS__FIELDS]: [
            FIELD__TEXT,
            FIELD__MEDIA_TYPE,
            FIELD__MEDIA_URL,
            FIELD__PERMALINK,
            FIELD__TIMESTAMP,
        ].join(','),
        limit: limit ?? DEFAULT_THREADS_QUERY_LIMIT,
        [PARAMS__USERNAME]: username,
    };
    if (before) {
        profilePostsParams.before = before;
    }
    if (after) {
        profilePostsParams.after = after;
    }

    let threads = [];
    let paging = {};

    const queryThreadsUrl = buildGraphAPIURL(
        `profile_posts`,
        profilePostsParams,
        req.session.access_token
    );

    try {
        const queryResponse = await axios.get(queryThreadsUrl, {
            httpsAgent: agent,
        });
        threads = queryResponse.data.data;

        if (queryResponse.data.paging) {
            const { next, previous } = queryResponse.data.paging;

            if (next) {
                paging.nextUrl = getCursorUrlFromGraphApiPagingUrl(req, next);
            }

            if (previous) {
                paging.previousUrl = getCursorUrlFromGraphApiPagingUrl(
                    req,
                    previous
                );
            }
        }
    } catch (e) {
        console.error(e?.response?.data?.error?.message ?? e.message);
    }

    return res.render('profile_lookup', {
        title: 'Profile Lookup for @'.concat(username),
        username,
        displayName,
        profilePictureUrl,
        isVerified,
        bio,
        followerCount,
        likesCount,
        quotesCount,
        repliesCount,
        repostsCount,
        viewsCount,
        paging,
        threads,
    });
});

https
    .createServer(
        {
            key: fs.readFileSync(
                path.join(__dirname, '../' + HOST + '-key.pem')
            ),
            cert: fs.readFileSync(path.join(__dirname, '../' + HOST + '.pem')),
        },
        app
    )
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
    req.session.user_id_binding = undefined;
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
 * @param {{ value?: number, link_total_values: { value: number }[] }[]} metrics
 * @param {number} index
 */
function getInsightsValueForClicks(metrics, index) {
    if (metrics[index] && metrics[index].link_total_values) {
        metrics[index].value = metrics[index]?.link_total_values?.reduce(
            (sum, { value }) => sum + value,
            0
        );
    } else {
        metrics[index].value = 0;
    }
}

/**
 * @param {object} target
 * @param {string} attachmentType
 * @param {string} url
 */
function addAttachmentFields(target, attachmentType, url, altText) {
    if (attachmentType === 'Image') {
        target.media_type = MEDIA_TYPE__IMAGE;
        target.image_url = url;
        target.alt_text = altText;
    } else if (attachmentType === 'Video') {
        target.media_type = MEDIA_TYPE__VIDEO;
        target.video_url = url;
        target.alt_text = altText;
    }
}

/**
 * @param {int} timestamp
 */
function formatTimestamp(timestamp) {
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return DateTime.fromSeconds(timestamp, {
        zone: userTimeZone,
    }).toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS);
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

    const requestUrl = new URL(
        req.protocol + '://' + req.get('host') + req.originalUrl
    );
    const cursorUrl = new URL(requestUrl);
    cursorUrl.search = '';

    setUrlParamIfPresent(requestUrl, cursorUrl, 'keyword');
    setUrlParamIfPresent(requestUrl, cursorUrl, 'searchMode');
    setUrlParamIfPresent(requestUrl, cursorUrl, 'searchType');
    setUrlParamIfPresent(requestUrl, cursorUrl, 'mediaType');
    setUrlParamIfPresent(requestUrl, cursorUrl, 'authorUsername');
    setUrlParamIfPresent(requestUrl, cursorUrl, PARAMS__SINCE);
    setUrlParamIfPresent(requestUrl, cursorUrl, PARAMS__UNTIL);
    setUrlParamIfPresent(requestUrl, cursorUrl, PARAMS__LIMIT);
    setUrlParamIfPresent(graphUrl, cursorUrl, PARAMS__LIMIT);
    setUrlParamIfPresent(graphUrl, cursorUrl, PARAMS__SINCE);
    setUrlParamIfPresent(graphUrl, cursorUrl, PARAMS__UNTIL);
    setUrlParamIfPresent(graphUrl, cursorUrl, PARAMS__BEFORE);
    setUrlParamIfPresent(graphUrl, cursorUrl, PARAMS__AFTER);
    setUrlParamIfPresent(graphUrl, cursorUrl, 'username');

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
            FIELD__ALT_TEXT,
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
    const queryThreadsUrl = buildGraphAPIURL(
        `${threadId}/${repliesOrConversation}`,
        params,
        req.session.access_token
    );

    try {
        const queryResponse = await axios.get(queryThreadsUrl, {
            httpsAgent: agent,
        });
        replies = queryResponse.data.data;

        if (queryResponse.data.paging) {
            const { next, previous } = queryResponse.data.paging;

            if (next)
                paging.nextUrl = getCursorUrlFromGraphApiPagingUrl(req, next);

            if (previous)
                paging.previousUrl = getCursorUrlFromGraphApiPagingUrl(
                    req,
                    previous
                );
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
