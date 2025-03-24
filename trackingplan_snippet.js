/* Trackingplan snippet to be included in on top of templates to be monitored by Trackingplan */
const sendHttpRequest = (url, options, body) => {
    require('addEventCallback')(() => {
        require('sendMessage')('tp_request', { url: url, body: body });
    });
    return require('sendHttpRequest')(url, options, body);
};
const sendHttpGet = function (url, options) {
    require('addEventCallback')(() => {
        require('sendMessage')('tp_request', { url: url });
    });
    return require('sendHttpGet')(url, options);
};
/* End of Trackingplan snippet */