import { Constants } from "../constants";

const pathname = `${Constants.SERVICE_WORKER_PATH}?v=${Constants.SIYUAN_VERSION}`;

// https://github.com/siyuan-note/siyuan/pull/8012
export const registerServiceWorker = async (
    scirpt: string | URL = pathname,
    scope: string = "/",
    workerType: WorkerType = "module",
) => {
    if (("serviceWorker" in window.navigator) && ("caches" in window) && ("fetch" in window)) {
        try {
            // REF https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration
            const registration = await window.navigator.serviceWorker.register(scirpt, {
                scope,
                type: workerType,
            });
            await registration.update();
            return true;
        } catch (error) {
            console.warn(`Registration service worker failed with ${error}`);
        }
    }
    return false;
};

export const unregisterServiceWorker = async (
    scirpt: string | URL = pathname,
    scope: string = "/",
) => {
    if ("serviceWorker" in window.navigator) {
        try {
            const scriptURL = new URL(scirpt, window.document.baseURI);
            const scopeURL = new URL(scope, window.document.baseURI);

            const registration = await window.navigator.serviceWorker.getRegistration(scope);
            if (isTargetRegistration(scriptURL, scopeURL, registration)) {
                const result = await registration.unregister();
                console.debug(`Unregistration service worker ${result ? "succeeded" : "failed"}`);
                return result;
            }
        } catch (error) {
            console.warn(`Unregistration service worker failed with ${error}`);
        }
    }
    return false;
}

/* ❗加载同一个 worker 时不会触发 */
export const disableServiceWorker = (
    scirpt: string | URL = pathname,
    scope: string = "/",
) => {
    if ("serviceWorker" in window.navigator) {
        try {
            const scriptURL = new URL(scirpt, window.document.baseURI);
            const scopeURL = new URL(scope, window.document.baseURI);

            const listener = async (e: Event) => {
                console.debug(e);
                const container = e.target as ServiceWorkerContainer;
                const controllerScriptURL = new URL(container.controller.scriptURL);
                if (scriptURL.pathname === controllerScriptURL.pathname) {
                    const registration = await container.ready;
                    if (isTargetRegistration(scriptURL, scopeURL, registration)) {
                        const result = await registration.unregister();
                        console.debug(`Auto unregistration service worker ${result ? "succeeded" : "failed"}`);
                    }
                }
            };
            window.navigator.serviceWorker.addEventListener("controllerchange", listener);
            return () => window.navigator.serviceWorker.removeEventListener("controllerchange", listener);
        } catch (error) {
        }
    }
    return () => {};
}

const isTargetRegistration = (
    scriptURL: URL,
    scopeURL: URL,
    registration: ServiceWorkerRegistration,
) => {
    try {
        if (registration?.active?.scriptURL && registration?.scope) {
            const registrationScriptURL = new URL(registration.active.scriptURL);
            const registrationScopeURL = new URL(registration.scope);
            return scriptURL.pathname === registrationScriptURL.pathname
                && scopeURL.pathname === registrationScopeURL.pathname;
        }
    } catch (error) {
    }
    return false
}
