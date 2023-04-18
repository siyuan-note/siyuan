// https://github.com/siyuan-note/siyuan/pull/8012
export const registerServiceWorker = (scriptURL: string) => {
    if (window.navigator.serviceWorker) {
        // REF https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration
        window.navigator.serviceWorker
            .register(scriptURL, {
                scope: "./",
                type: "module",
            }).then(registration => {
                if (registration.installing) {
                    console.debug("Service worker installing");
                } else if (registration.waiting) {
                    console.debug("Service worker installed");
                } else if (registration.active) {
                    console.debug("Service worker active");
                }
                registration.update();
            }).catch(e => {
                console.debug(`Registration failed with ${e}`);
            });

        // REF https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/message_event
        window.navigator.serviceWorker.addEventListener("message", event => {
            // event is a MessageEvent object
            console.debug("client: onmessage", event);
        });

        window.navigator.serviceWorker.ready.then(registration => {
            registration.active.postMessage("client: post message");
        });
    }
};
