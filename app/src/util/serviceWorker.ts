// https://github.com/siyuan-note/siyuan/pull/8012
export const registerServiceWorker = (
    scriptURL: string,
    options: RegistrationOptions = {
        scope: "/",
        type: "classic",
        updateViaCache: "all",
    },
) => {
    /// #if BROWSER
    if (window.webkit?.messageHandlers || window.JSAndroid || window.JSHarmony ||
        !("serviceWorker" in window.navigator)
        || !("caches" in window)
        || !("fetch" in window)
        || navigator.serviceWorker == null
    ) {
        return;
    }

    // REF https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration
    window.navigator.serviceWorker
        .register(scriptURL, options)
        .then(registration => {
            registration.update();
        }).catch(e => {
        console.debug(`Registration failed with ${e}`);
    });
    /// #endif
};
