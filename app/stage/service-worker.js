// REF https://github.com/MicrosoftEdge/Demos/blob/main/pwamp/sw.js

const url = new URL(location.href);
const SIYUAN_VERSION = url.searchParams.get("v");
const CACHE_NAME = `siyuan-${SIYUAN_VERSION}`;
const INITIAL_CACHED_RESOURCES = [
    "/favicon.ico",
];

self.addEventListener("message", event => {
    // event is an ExtendableMessageEvent object
    console.debug("service-worker: onmessage", event);
    event.source.postMessage("service-worker: post message");
});

self.addEventListener("install", event => {
    console.debug("service-worker: oninstall", event);
    self.skipWaiting();
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        cache.addAll(INITIAL_CACHED_RESOURCES);
    })());
});

self.addEventListener("activate", event => {
    console.debug("service-worker: onactivate", event);
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.map(name => {
            if (name !== CACHE_NAME) {
                return caches.delete(name);
            }
        }));
        await clients.claim();
    })());
});

(async () => {
    self.addEventListener("fetch", event => {
        const url = new URL(event.request.url);

        // Don't care about other-origin URLs.
        if (url.origin !== location.origin) {
            return;
        }

        // Don't care about anything else than GET.
        if (event.request.method !== 'GET') {
            return;
        }

        // Don't care about widget requests.
        if (!url.pathname.startsWith("/stage/")) {
            return;
        }

        // On fetch, go to the cache first, and then network.
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cachedResponse = await cache.match(url.pathname);

            if (cachedResponse) {
                return cachedResponse;
            } else {
                const fetchResponse = await fetch(url.pathname);
                cache.put(url.pathname, fetchResponse.clone());
                return fetchResponse;
            }
        })());
    });
})();
