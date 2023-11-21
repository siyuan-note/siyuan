// https://github.com/siyuan-note/siyuan/pull/8012
export const registerServiceWorker = async (scriptURL: string, scope = "/", workerType: WorkerType = "module") => {
    if (("serviceWorker" in window.navigator) && ("caches" in window) && ("fetch" in window)) {
        try {
            // REF https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration
            const registration = await window.navigator.serviceWorker.register(scriptURL, {
                scope,
                type: workerType,
            });
            await registration.update();
            return true;
        } catch (error) {
            console.debug(`Registration failed with ${error}`);
            return false;
        }
    }
    return false;
};
