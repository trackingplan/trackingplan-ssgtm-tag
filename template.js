/**
 * Trackingplan SSGTM Template
 * ============================
 *
 * This Server-Side Google Tag Manager template integrates with Trackingplan's martech
 * governance platform. It captures tracking events from various providers (Google Analytics,
 * Facebook, TikTok, etc.), batches them efficiently, and sends them to Trackingplan's API
 * for analysis and monitoring.
 *
 * How it works:
 * ------------
 * 1. Intercepts tracking events from GTM and external providers via message listeners
 * 2. Creates standardized "raw track" objects with provider-specific information
 * 3. Applies sampling based on configuration (if enabled)
 * 4. Batches events for efficient transmission
 * 5. Sends batches to Trackingplan's API when size threshold or time threshold is reached
 *
 * Configuration Options:
 * ---------------------
 * - TP_ID: Your Trackingplan ID (required)
 * - MAX_BATCH_SIZE: Maximum number of events to include in a single batch (default: 20)
 * - MAX_BATCH_AGE_SECONDS: Maximum time to wait before sending a batch (default: 5 seconds)
 * - SAMPLING_RATE: Event sampling rate (1 = all events, 10 = 10% of events, etc.)
 * - ENVIRONMENT: Environment identifier (default: "PRODUCTION").
 * - ENDPOINT: Trackingplan API endpoint (default: https://tracks.trackingplan.com/v1/)
 * - TAGS: Custom key-value pairs to send with all events
 * - EXTRA_LOG: Enable detailed logging for debugging
 *
 * @version 1
 * @see https://docs.trackingplan.com/
 */

const VERSION = "1";

const addMessageListener = require('addMessageListener');
const logToConsole = require('logToConsole');
const getAllEventData = require('getAllEventData');
const getRequestHeader = require('getRequestHeader');
const getRequestBody = require('getRequestBody');
const getRequestPath = require('getRequestPath');
const getRequestQueryString = require('getRequestQueryString');
const sendHttpRequest = require('sendHttpRequest');
const JSON = require('JSON');
const templateDataStorage = require('templateDataStorage');
const getTimestampMillis = require('getTimestampMillis');
const generateRandom = require('generateRandom');
const makeInteger = require('makeInteger');
const getContainerVersion = require('getContainerVersion');

/**
 * Parses, validates, and returns all options from the data object.
 * @return {Object} All configuration options with appropriate defaults
 */
const getOptions = () => {
    const options = {
        MAX_BATCH_SIZE: makeInteger(data.maxBatchSize) || 20,
        MAX_BATCH_AGE_MS: (makeInteger(data.maxBatchAgeSeconds) || 5) * 1000,
        TP_ID: data.tpId,
        SAMPLING_RATE: makeInteger(data.samplingRate) || 1,
        ENVIRONMENT: data.environment || "PRODUCTION",
        ENDPOINT: data.endpoint || 'https://tracks.trackingplan.com/v1/',
        CUSTOM_TAGS: {},
        EXTRA_LOG: !!data.extraLog,
        VERSION: VERSION
    };

    // Process custom tags from data.TAGS
    if (data.tags && data.tags.length) {
        for (var i = 0; i < data.tags.length; i++) {
            var tagPair = data.tags[i];
            // Only add tags with non-empty keys
            if (tagPair.key && tagPair.key.trim() !== '') {
                options.CUSTOM_TAGS[tagPair.key] = tagPair.value;
            }
        }
    }

    // Construct webhook URL with proper trailing slash handling
    options.WEBHOOK_URL = options.ENDPOINT +
        (options.ENDPOINT.charAt(options.ENDPOINT.length - 1) === '/' ? '' : '/') +
        options.TP_ID + '?ssgtm=true';

    return options;
};

// Parse all configuration options once
const OPTIONS = getOptions();

/**
 * Logging utility that respects the EXTRA_LOG setting
 *
 * @param {boolean} alwaysLog If true, always log regardless of EXTRA_LOG setting
 * @param {string} label The log label
 * @param {*} arg1 First optional argument
 * @param {*} arg2 Second optional argument
 * @param {*} arg3 Third optional argument
 */
const log = function (alwaysLog, label, arg1, arg2, arg3) {
    if (!alwaysLog && !OPTIONS.EXTRA_LOG) {
        return;
    }

    // Add "Trackingplan: " prefix to string labels if not already present
    var prefixedLabel = label;
    if (typeof label === 'string' && label.indexOf('Trackingplan: ') !== 0) {
        prefixedLabel = 'Trackingplan: ' + label;
    }

    if (arg3 !== undefined) {
        logToConsole(prefixedLabel, arg1, arg2, arg3);
    } else if (arg2 !== undefined) {
        logToConsole(prefixedLabel, arg1, arg2);
    } else if (arg1 !== undefined) {
        logToConsole(prefixedLabel, arg1);
    } else {
        logToConsole(prefixedLabel);
    }
};

// Log configuration - Essential information always logged
log(false, "TRACKINGPLAN OPTIONS", OPTIONS);

// Detailed logging only when EXTRA_LOG is enabled
log(false, "FULL CONFIG DATA", data);

/**
 * Creates a raw track object from an intercepted request or original request.
 *
 * @param {string} provider The provider name (either "ssgtm_event" or "ssgtm_message")
 * @param {Object} request The request object containing url, body, and optional method
 * @return {Object} A formatted raw track object
 */
const createRawTrack = (provider, request) => {
    // Get event data to extract the href/page_location
    const eventData = getAllEventData();

    // Try to get the href from different sources with fallbacks
    const href = (eventData && eventData.page_location) ||
        getRequestHeader('referer') ||
        null;

    const currentTime = getTimestampMillis();

    return {
        // Use fixed provider names (ssgtm_event or ssgtm_message)
        "provider": provider,
        "request": {
            // The original endpoint URL
            "endpoint": request.url,
            // The request method
            "method": request.method || "POST",
            // The post payload, in its original form
            "post_payload": request.body || null,
            "protocol": "ssgtm",
            // The url the event has been triggered at (if available)
            "href": href,
        },
        // Custom tags from configuration
        "tags": OPTIONS.CUSTOM_TAGS,
        // Top-level timestamp
        "ts": currentTime
    };
};

/**
 * Processes the GTM event and adds it to the queue
 */
const processGTMEvent = () => {
    // Capture the original request when the tag loads
    const originalRequestUrl = getRequestPath() || '';
    const queryString = getRequestQueryString();

    // Append the query string to the path if it exists
    const fullRequestUrl = queryString ? originalRequestUrl + '?' + queryString : originalRequestUrl;

    // Use ssgtm_event as the provider for GTM events
    const provider = "ssgtm_event";

    // Capture the original request
    const originalRequest = {
        url: fullRequestUrl,
        body: getRequestBody(),
        method: getRequestHeader('method') || "GET"
    };

    // Construct the post_payload with event_data and original_request
    const postPayload = {
        event_data: getAllEventData(),
        original_request: originalRequest
    };

    // Create raw track with the new post_payload
    const raw_track = createRawTrack(provider, {
        url: fullRequestUrl,
        body: postPayload,
        method: getRequestHeader('method') || "GET"
    });

    if (!raw_track) {
        log(true, "ERROR: Failed to create raw track for GTM event");
        return;
    }

    log(false, "GTM EVENT PROCESSED", {
        provider: provider,
        url: fullRequestUrl
    });

    // Add to queue
    addToQueue(raw_track);
};

/**
 * Sets up a message listener for intercepted requests
 */
const setupMessageListener = () => {
    // Listen for messages of type "tp_request"
    addMessageListener('tp_request', (messageType, message) => {
        log(false, "message_received", messageType, message);

        if (!message || !message.url) {
            log(true, "ERROR: Invalid message received", message);
            return;
        }

        // Create a request object from the message
        const request = {
            url: message.url,
            body: message.body || null,
            method: 'POST' // Assuming POST as default for intercepted requests
        };

        // Use ssgtm_message as the provider for all intercepted messages
        const provider = "ssgtm_message";

        const raw_track = createRawTrack(provider, request);
        if (!raw_track) {
            log(true, "ERROR: Failed to create raw track for intercepted request");
            return;
        }

        // Add to queue
        addToQueue(raw_track);
    });
};

/**
 * Adds a raw track to the queue for batching
 *
 * @param {Object} rawTrack The raw track to add to the queue
 */
const addToQueue = (rawTrack) => {

    // Apply sampling - randomly select 1/SAMPLING_RATE of events
    if (OPTIONS.SAMPLING_RATE > 1) {
        const randomValue = generateRandom(1, OPTIONS.SAMPLING_RATE);

        if (randomValue > 1) {
            log(false, "SAMPLING - Track skipped due to sampling (rate: 1/" + OPTIONS.SAMPLING_RATE + ")");
            return;
        }
    }

    // Always get the latest queue before any modifications
    let queue = templateDataStorage.getItemCopy('rawTrackQueue') || [];
    let queueStartTime = templateDataStorage.getItemCopy('queueStartTime') || 0;

    // Log initial state
    log(false, "QUEUE DEBUG - Initial State", {
        queue_length: queue.length,
        queue_start_time: queueStartTime,
        current_time: getTimestampMillis()
    });

    // If queue is empty, set the start time
    if (queue.length === 0) {
        queueStartTime = getTimestampMillis();
        templateDataStorage.setItemCopy('queueStartTime', queueStartTime);
        log(false, "QUEUE DEBUG - Created new queue with timestamp:", queueStartTime);
    }

    // Add the raw track to the queue
    queue.push(rawTrack);

    // Store the updated queue immediately
    templateDataStorage.setItemCopy('rawTrackQueue', queue);

    log(false, "QUEUE DEBUG - Added track for provider:", rawTrack);
    log(false, "QUEUE DEBUG - Queue size now:", queue.length);

    // Check if we should send the batch
    const currentTime = getTimestampMillis();
    const timeElapsed = currentTime - queueStartTime;
    log(false, "QUEUE DEBUG - Time elapsed", {
        elapsed: timeElapsed,
        max: OPTIONS.MAX_BATCH_AGE_MS
    });

    const sendDueToSize = queue.length >= OPTIONS.MAX_BATCH_SIZE;
    const sendDueToTime = timeElapsed >= OPTIONS.MAX_BATCH_AGE_MS && queue.length > 0;

    log(false, "QUEUE DEBUG - Send status", {
        sendDueToSize: sendDueToSize,
        sendDueToTime: sendDueToTime
    });

    if (sendDueToSize || sendDueToTime) {
        // Send the current queue snapshot
        sendBatch(queue);
    } else {
        log(false, "QUEUE DEBUG - Batch not sent yet. Waiting for more tracks or timeout.");
    }
};

/**
 * Sends a batch of raw tracks to the Trackingplan API
 *
 * @param {Array} queueToSend The queue of raw tracks to send
 */
const sendBatch = (queueToSend) => {
    // If queue is not provided, get the latest state
    let queue = queueToSend;
    if (!queue) {
        queue = templateDataStorage.getItemCopy('rawTrackQueue') || [];
    }

    // Don't send if queue is empty
    if (!queue.length) {
        log(false, "QUEUE DEBUG - Empty queue, nothing to send");
        return;
    }

    // Get container info to include as tags
    const containerInfo = getContainerVersion();

    // Create tags object with container info
    const tags = {};
    if (containerInfo) {
        // Add each container property as a tag with prefix
        for (var key in containerInfo) {
            if (containerInfo.hasOwnProperty(key)) {
                tags['ssgtm_container_version.' + key] = containerInfo[key];
            }
        }

        // Add a special tag for gtm_container_version
        tags.gtm_container_version = containerInfo.version;
    }

    const batchPayload = {
        requests: queue,
        common: {
            context: {},
            // A key that identifies the customer
            tp_id: OPTIONS.TP_ID,
            // An optional alias that identifies the source
            source_alias: "SSGTM",
            // An optional environment. Can be "PRODUCTION" or "TESTING"
            environment: OPTIONS.ENVIRONMENT,
            // The used sdk
            sdk: "ssgtm",
            // The SDK version
            sdk_version: OPTIONS.VERSION,
            // The rate at which this specific track has been sampled
            sampling_rate: OPTIONS.SAMPLING_RATE,
            // Container info tags
            tags: tags
        }
    };

    log(false, "BATCH PAYLOAD TO SEND", batchPayload);

    // Send the batch to the webhook
    sendHttpRequest(OPTIONS.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify(batchPayload))
        .then((response) => {
            // Combined log with both batch info and response
            log(true, "BATCH SENT", {
                endpoint: OPTIONS.WEBHOOK_URL,
                payload_size: queue.length,
                response: response.statusCode
            });

            // Safe queue clearing - only remove the items we sent
            let currentQueue = templateDataStorage.getItemCopy('rawTrackQueue') || [];

            // If the current queue is longer than what we sent, it means new items were added
            // We only remove the items we sent, keeping the new ones
            if (currentQueue.length > queue.length) {
                // Only remove the number of items we processed
                // This assumes FIFO queue behavior where older items are at the beginning
                let updatedQueue = currentQueue.slice(queue.length);
                templateDataStorage.setItemCopy('rawTrackQueue', updatedQueue);
                log(false, "QUEUE DEBUG - Queue partially cleared", {
                    processed_items: queue.length,
                    remaining_items: updatedQueue.length
                });
            } else {
                // If current queue size <= sent queue size, clear everything
                templateDataStorage.setItemCopy('rawTrackQueue', []);
                // Reset queue start time only if we cleared the entire queue
                templateDataStorage.setItemCopy('queueStartTime', 0);
                log(false, "QUEUE DEBUG - Queue cleared", {
                    cleared_items: currentQueue.length
                });
            }
        })
        .catch((error) => {
            log(true, "ERROR: Failed to send batch", error);
            // On error, we'll leave the queue as is for a retry later
        });
};

/**
 * Checks if there's a stale batch that needs to be sent
 * This handles cases where the container might have been idle for a while
 */
const checkStaleQueue = () => {
    const queue = templateDataStorage.getItemCopy('rawTrackQueue') || [];
    const queueStartTime = templateDataStorage.getItemCopy('queueStartTime') || 0;

    if (queue.length === 0 || queueStartTime === 0) {
        return;
    }

    const currentTime = getTimestampMillis();
    const timeElapsed = currentTime - queueStartTime;

    if (timeElapsed >= OPTIONS.MAX_BATCH_AGE_MS) {
        log(false, "QUEUE DEBUG - Found stale queue, sending batch");
        sendBatch(queue);
    }
};

// Initialize the template
const initialize = () => {
    // Process the GTM event
    processGTMEvent();

    // Set up the message listener
    setupMessageListener();

    // Check for stale batches
    checkStaleQueue();

    // Indicate the tag has finished setup
    data.gtmOnSuccess();
};

// Start the template
initialize();