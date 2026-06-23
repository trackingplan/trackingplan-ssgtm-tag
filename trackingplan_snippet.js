/* Trackingplan snippet to be included in on top of templates to be monitored by Trackingplan */
const sendHttpRequest = (url, arg2, arg3, arg4) => {
    /* sendHttpRequest has two runtime signatures: the documented Promise form
       sendHttpRequest(url, options, body) and the legacy callback form
       sendHttpRequest(url, callback, options, body) used by CAPI templates
       (Pinterest, Facebook). Detect the callback form by its function 2nd arg. */
    const isCallbackForm = typeof arg2 === 'function';
    const body = isCallbackForm ? arg4 : arg3;
    require('addEventCallback')(() => {
        require('sendMessage')('tp_request', { url: url, body: body });
    });
    return isCallbackForm
        ? require('sendHttpRequest')(url, arg2, arg3, arg4)
        : require('sendHttpRequest')(url, arg2, arg3);
};
const sendHttpGet = function (url, options) {
    require('addEventCallback')(() => {
        require('sendMessage')('tp_request', { url: url });
    });
    return require('sendHttpGet')(url, options);
};
/* End of Trackingplan snippet */