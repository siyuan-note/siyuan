// https://github.com/siyuan-note/siyuan/pull/8012
export const registerServiceWorker = (scriptURL: string, scope = "/", workerType: WorkerType = "module") => {
    if (!("serviceWorker" in navigator) || typeof (navigator.serviceWorker) === "undefined" ||
        !("caches" in window) || !("fetch" in window)) {
        return;
    }
    // REF https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration
    window.navigator.serviceWorker
        .register(scriptURL, {
            scope,
            type: workerType,
        }).then(registration => {
        registration.update();
    }).catch(e => {
        console.debug(`Registration failed with ${e}`);
    });
};
