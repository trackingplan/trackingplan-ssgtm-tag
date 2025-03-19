# Trackingplan SSGTM Template

[![Trackingplan](https://img.shields.io/badge/Powered%20by-Trackingplan-blue)](https://trackingplan.com)
[![Server-Side GTM](https://img.shields.io/badge/SSGTM-Compatible-green)](https://developers.google.com/tag-platform/tag-manager/server-side)

A Server-Side Google Tag Manager (SSGTM) template that integrates with Trackingplan's analytics governance platform. This template captures tracking events from GTM and client-side requests, batches them efficiently, and sends them to Trackingplan's API for analysis and monitoring.

## How It Works

1. **Event capture**: Intercepts tracking events from:
   - Server-Side GTM events
   - Client-side events sent via message listeners

2. **Event standardization**: Creates standardized "raw track" objects with all necessary information

3. **Batching mechanism**:
   - Collects events in a queue until reaching batch size or time threshold
   - Handles concurrent request batching

4. **Data transmission**:
   - Sends batches to Trackingplan's API
   - Adds GTM container information as tags


## How to modify the tags you want to monitor

This should be done on all the templates that want to be monitored by Trackingplan.

1. Open the tag template (this works on any tag)
2. Add Trackingplan Snippet to the top of the Template (see code below)
3. Remove/Comment the original sendHttpRequest and sendHttpGet require statements.
4. Enable the Send / Receive Message Permission
5. Save
6. And don't forget to publish your changes

### Trackingplan Snippet

```javascript
/* Trackingplan snippet */
const sendHttpRequest = (url, options, body) => {
  require('sendMessage')('tp_request', { url: url, body: body });
  return require('sendHttpRequest')(url, options, body);
};
const sendHttpGet = function(url, options) {
  require('sendMessage')('tp_request', { url: url });
  return require('sendHttpGet')(url, options);
};
/* End of Trackingplan snippet */
```

## Installation

1. **Import the template to your SSGTM container (if not using gallery)**:
   - Download this template
   - In your SSGTM container, go to Templates → New → Import from file
   - Select the downloaded template file

2. **Create a new tag using the template**:
   - In your SSGTM container, go to Tags → New
   - Select the Trackingplan template
   - Configure the required settings (see Configuration section)
   - Set appropriate trigger rules (typically "All Events")

3. **Publish your container**

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `tpId` | Your Trackingplan ID (required) | None |
| `maxBatchSize` | Maximum number of events in a batch | 1 |
| `maxBatchAgeSeconds` | Maximum time to wait before sending a batch | 5 |
| `samplingRate` | Event sampling rate (1 = all events, 10 = 10% of events) | 1 |
| `environment` | Environment identifier ("PRODUCTION" or "TESTING") | "PRODUCTION" |
| `endpoint` | Trackingplan API endpoint | "https://tracks.trackingplan.com/v1/" |
| `tags` | Custom key-value pairs to send with all events | {} |
| `extraLog` | Enable detailed logging for debugging | false |

## Debugging

When troubleshooting, enable the `extraLog` option to get detailed information about:

- Event processing
- Batch creation and sending
- API responses

Logs can be viewed in the Server-Side GTM container's preview mode under the "Logs" tab.

## License

This template is provided under the [Apache 2.0 License](LICENSE).

## Support

For support, please contact [support@trackingplan.com](mailto:support@trackingplan.com) or visit the [Trackingplan documentation](https://docs.trackingplan.com/).