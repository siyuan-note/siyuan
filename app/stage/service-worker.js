// REF https://github.com/MicrosoftEdge/Demos/blob/main/pwamp/sw.js

const CACHE_NAME = `siyuan-${new URL(location.href).searchParams.get("v")}`;
const INITIAL_CACHED_RESOURCES = [
    "/favicon.ico",
    "/stage/icon-large.png",
    "/stage/icon.png",
    "/stage/loading-pure.svg",
    "/stage/build/fonts/JetBrainsMono-Regular.woff2",
    "/stage/protyle/js/lute/lute.min.js",
    "/stage/protyle/js/protyle-html.js"
];

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        cache.addAll(INITIAL_CACHED_RESOURCES);
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.map(name => {
            navigator.storage.estimate().then((storageStats) => {
                if (name !== CACHE_NAME || storageStats.usage / storageStats.quota > 0.8) {
                    return caches.delete(name)
                }
            })
        }));
        await clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);

    // Don't care about other-origin URLs.
    if (url.origin !== location.origin &&
        url.origin !== "https://assets.b3logfile.com"
    ) {
        return;
    }

    // Don't care about anything else than GET.
    if (event.request.method !== 'GET' ||
        event.request.destination === "document"
    ) {
        return;
    }

    // Don't care about other requests.
    if (!url.pathname.startsWith("/stage/") &&
        !url.pathname.startsWith("/appearance/boot/") &&
        !url.pathname.startsWith("/appearance/emojis/") &&
        !url.pathname.startsWith("/appearance/langs/") &&
        !url.href.startsWith("https://assets.b3logfile.com/") &&
        url.pathname !== "/favicon.ico"
    ) {
        return;
    }

    // On fetch, go to the cache first, and then network.
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(url.pathname);
        if (cachedResponse && cachedResponse.type !== 'opaque') {
            return cachedResponse;
        } else {
            const fetchResponse = await fetch(event.request);
            cache.put(url.pathname, fetchResponse.clone());
            return fetchResponse;
        }
    })());
});
