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
 * 6. Detects duplicates in GTM events and skips them
 *
 * Configuration Options:
 * ---------------------
 * - tpId: Your Trackingplan ID (required)
 * - maxBatchSize: Maximum number of events to include in a single batch (default: 20)
 * - maxBatchAgeSeconds: Maximum time to wait before sending a batch (default: 5 seconds)
 * - samplingRate: Event sampling rate (1 = all events, 10 = one out of 10 of events, etc.)
 * - environment: Environment identifier (default: "PRODUCTION").
 * - endpoint: Trackingplan API endpoint (default: https://tracks.trackingplan.com/v1/)
 * - tags: Custom key-value pairs to send with all events
 * - extraLog: Enable detailed logging for debugging (default: false)
 * - useSessions: Enable session tracking (default: false)
 * - captureGTM: Enable GTM event capture (default: false)
 *
 * @version 2
 * @see https://docs.trackingplan.com/
 */

const VERSION = "2";

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
const Math = require('Math');
const getCookieValues = require('getCookieValues');
const setCookie = require('setCookie');


/**
 * Parses, validates, and returns all options from the data object.
 * @return {Object} All configuration options with appropriate defaults
 */
const getOptions = () => {
    const options = {
        MAX_BATCH_SIZE: makeInteger(data.maxBatchSize) || 1,
        MAX_BATCH_AGE_MS: (makeInteger(data.maxBatchAgeSeconds) || 5) * 1000,
        TP_ID: data.tpId,
        SAMPLING_RATE: makeInteger(data.samplingRate) || 1,
        ENVIRONMENT: data.environment || "PRODUCTION",
        ENDPOINT: data.endpoint || 'https://tracks.trackingplan.com/v1/',
        CUSTOM_TAGS: {},
        EXTRA_LOG: !!data.extraLog,
        VERSION: VERSION,
        // Add useSessions parameter with default value of false
        USE_SESSIONS: !!data.useSessions,
        // Add captureGTM parameter with default value of false
        CAPTURE_GTM: !!data.captureGTM,
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
 * Generates a UUID v4 (random) compliant string using sGTM's generateRandom
 * This is a pure implementation that avoids using browser APIs or external libraries
 * @return {string} A UUID v4 string
 */
const generateUUID = () => {
    const hex = [];
    for (let i = 0; i < 36; i++) {
        if (i === 8 || i === 13 || i === 18 || i === 23) {
            hex[i] = '-';
        } else if (i === 14) {
            // Version 4 UUID has '4' at this position
            hex[i] = '4';
        } else if (i === 19) {
            // UUID v4 needs (8, 9, a, or b) at this position
            const randVal = generateRandom(8, 11);
            hex[i] = (randVal === 10 ? 'a' : randVal === 11 ? 'b' : randVal).toString(16);
        } else {
            const randVal = generateRandom(0, 15);
            hex[i] = randVal.toString(16);
        }
    }
    return hex.join('');
};


/**
 * Updates and returns the session ID, creating a new one if needed
 * Session expires after 30 minutes of inactivity
 * @return {string} The current session ID
 */
const updateAndGetSessionId = () => {
    const COOKIE_NAME = '_TP_SID';
    const SESSION_TIMEOUT_MINS = 30;
    
    // Try to get existing session ID
    const existingSessionId = getCookieValues(COOKIE_NAME)[0];
    
    if (existingSessionId) {
        // Extend the session by setting the cookie again
        setCookie(COOKIE_NAME, existingSessionId, {
            'max-age': SESSION_TIMEOUT_MINS * 60,
            'secure': true,
            'httpOnly': true
        });
        return existingSessionId;
    }
    
    // Create new session ID if none exists
    const newSessionId = generateUUID();
    setCookie(COOKIE_NAME, newSessionId, {
        'max-age': SESSION_TIMEOUT_MINS * 60,
        'secure': true,
        'httpOnly': true
    });
    
    return newSessionId;
};


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
log(false, "CONFIG DATA", data);

/**
 * Constants for hash tracking
 */
const HASH_STORAGE_KEY = 'seenHashes';
const MAX_HASH_SIZE = 100;

/**
 * Check if a hash has been seen and add it to the set
 * Returns true if the hash was already seen
 * 
 * @param {string} hash The hash to check and add
 * @return {boolean} True if the hash already existed
 */
const checkAndAddHash = (hash) => {
    if (!hash) return false;
    
    // Get the current set of seen hashes
    let seenHashes = templateDataStorage.getItemCopy(HASH_STORAGE_KEY) || [];
    
    // Check if the hash exists in the set using indexOf for simplicity
    const exists = seenHashes.indexOf(hash) !== -1;

    // If it doesn't exist, add it and maintain the set size
    if (!exists) {
        // Add the new hash
        seenHashes.push(hash);
        
        // Trim the array if it's too large (keep only the most recent MAX_HASH_SIZE hashes)
        if (seenHashes.length > MAX_HASH_SIZE) {
            // Remove oldest hashes (those at the beginning of the array)
            const toRemove = Math.max(seenHashes.length - MAX_HASH_SIZE, -1 * Math.floor(MAX_HASH_SIZE/2));
            seenHashes = seenHashes.slice(toRemove);
            
            log(false, "HASH CLEANUP - Removed oldest hashes to maintain size limit", {
                removed: toRemove,
                new_size: seenHashes.length
            });
        }
        
        // Save the updated set
        templateDataStorage.setItemCopy(HASH_STORAGE_KEY, seenHashes);
    }
    
    return exists;
};

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
        "ts": currentTime,
        // The event data
        "context": {
            "ssgtm_event_data": eventData
        }
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

    // Get event data for duplicate detection
    const eventData = getAllEventData();
    
    // Check for request_start_time_ms to detect duplicates
    if (eventData && eventData['x-sst-system_properties'] && eventData['x-sst-system_properties'].request_start_time_ms) {
        const trackHash = eventData['x-sst-system_properties'].request_start_time_ms.toString();
        
        // Check if this is a duplicate event
        if (checkAndAddHash(trackHash)) {
            log(false, "DUPLICATE GTM EVENT - Skipped processing", {
                request_start_time_ms: trackHash
            });
            return;
        }
    }

    // Create raw track with the new post_payload
    const raw_track = createRawTrack(provider, {
        url: fullRequestUrl,
        body: getRequestBody(),
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
    
    // Note: Duplicate detection for GTM events is now handled in processGTMEvent

    // Always get the latest queue before any modifications to ensure we have the most up-to-date state
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

    // Store the updated queue immediately to ensure it's saved
    templateDataStorage.setItemCopy('rawTrackQueue', queue);

    log(false, "QUEUE DEBUG - Added track for provider:", rawTrack.provider);
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
        sendDueToTime: sendDueToTime,
        queue_size: queue.length,
        max_batch_size: OPTIONS.MAX_BATCH_SIZE
    });

    // Only send if we have something to send and we meet the criteria
    if ((sendDueToSize || sendDueToTime) && queue.length > 0) {
        // Make a copy of the current queue to send
        // This ensures we're only sending what we intend to send
        const queueToSend = queue.slice(0);
        
        log(false, "QUEUE DEBUG - Sending batch due to " + 
            (sendDueToSize ? "size threshold" : "time threshold"), {
            queue_size: queueToSend.length
        });
        
        // Send a copy of the current queue
        sendBatch(queueToSend);
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

    // Store the length of the queue we're sending
    const sentQueueLength = queue.length;
    
    // Log what we're about to send
    log(false, "QUEUE DEBUG - Sending batch", {
        batch_size: sentQueueLength
    });

    // Get container info to include as tags
    const containerInfo = getContainerVersion();

    // Create tags object with container info
    const tags = OPTIONS.CUSTOM_TAGS;
    
    if (containerInfo) {
        // Add a special tag for gtm_container_version
        tags.gtm_container_version = containerInfo.version;
    }

    const batchPayload = {
        requests: queue,
        common: {
            context: { 
                ssgtm_container_version: containerInfo,
            },
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
            tags: tags,
            // Only include session_id if USE_SESSIONS is true
            session_id: OPTIONS.USE_SESSIONS ? updateAndGetSessionId() : null
        }
    };

    log(false, "BATCH PAYLOAD TO SEND", batchPayload);

    // Clear the queue immediately after preparing the payload
    // Get the current queue state
    let currentQueue = templateDataStorage.getItemCopy('rawTrackQueue') || [];
    
    // If the current queue is longer than what we sent, it means new items were added
    // We only remove the items we sent, keeping the new ones
    if (currentQueue.length > sentQueueLength) {
        // Only remove the number of items we processed
        // This assumes FIFO queue behavior where older items are at the beginning
        let updatedQueue = currentQueue.slice(sentQueueLength);
        templateDataStorage.setItemCopy('rawTrackQueue', updatedQueue);
        
        log(false, "QUEUE DEBUG - Queue partially cleared", {
            processed_items: sentQueueLength,
            remaining_items: updatedQueue.length
        });
    } else {
        // If current queue size <= sent queue size, clear everything
        templateDataStorage.setItemCopy('rawTrackQueue', []);
        // Reset queue start time
        templateDataStorage.setItemCopy('queueStartTime', 0);
        
        log(false, "QUEUE DEBUG - Queue fully cleared", {
            cleared_items: currentQueue.length
        });
    }

    // Send the batch to the webhook (fire and forget)
    sendHttpRequest(OPTIONS.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify(batchPayload))
        .then((response) => {
            // Just log the response
            log(true, "BATCH SENT", {
                endpoint: OPTIONS.WEBHOOK_URL,
                payload_size: sentQueueLength,
                response: response.statusCode
            });
        })
        .catch((error) => {
            log(true, "ERROR: Failed to send batch", error);
            // We don't retry since we already cleared the queue
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
        log(false, "QUEUE DEBUG - No stale queue to process");
        return;
    }

    const currentTime = getTimestampMillis();
    const timeElapsed = currentTime - queueStartTime;

    log(false, "QUEUE DEBUG - Checking for stale queue", {
        queue_size: queue.length,
        time_elapsed: timeElapsed,
        max_age: OPTIONS.MAX_BATCH_AGE_MS,
        is_stale: timeElapsed >= OPTIONS.MAX_BATCH_AGE_MS
    });

    if (timeElapsed >= OPTIONS.MAX_BATCH_AGE_MS) {
        log(false, "QUEUE DEBUG - Found stale queue, sending batch");
        
        // Make a copy of the current queue to send
        const queueToSend = queue.slice(0);
        
        // Send a copy of the current queue
        sendBatch(queueToSend);
    }
};


// Initialize the template
const initialize = () => {
    // Process the GTM event only if captureGTM is enabled
    if (OPTIONS.CAPTURE_GTM) {
        processGTMEvent();
    } 

    // Set up the message listener
    setupMessageListener();

    // Check for stale batches
    checkStaleQueue();

    // Indicate the tag has finished setup
    data.gtmOnSuccess();
};

// Start the template
initialize();
