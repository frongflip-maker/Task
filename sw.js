const SW_VERSION = "taskroutine-sw-1";
const SHELL_CACHE = `${SW_VERSION}-shell`;
const LIB_CACHE = `${SW_VERSION}-lib`;
const LIB_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"];

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.filter(key => !key.startsWith(SW_VERSION)).map(key => caches.delete(key)));
        } catch (error) {
            // ignore cache cleanup failures
        }
        try {
            await self.clients.claim();
        } catch (error) {
            // ignore claim failures
        }
    })());
});

self.addEventListener("message", event => {
    const type = event.data && event.data.type;
    if (type === "SW_UNREGISTER") {
        event.waitUntil((async () => {
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
            } catch (error) {
                // ignore
            }
            try {
                await self.registration.unregister();
            } catch (error) {
                // ignore
            }
        })());
    }
    if (type === "SW_CLEAR_CACHE") {
        event.waitUntil((async () => {
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
            } catch (error) {
                // ignore
            }
        })());
    }
});

const isDocumentRequest = request =>
    request.mode === "navigate" || (request.destination === "document");

const isLibRequest = url =>
    LIB_HOSTS.includes(url.hostname);

self.addEventListener("fetch", event => {
    let request;
    let url;
    try {
        request = event.request;
        if (!request || request.method !== "GET")
            return;
        url = new URL(request.url);
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return;
        if (url.hostname.endsWith(".supabase.co"))
            return;
        if (url.origin === self.location.origin && url.pathname === "/sw.js")
            return;
    } catch (error) {
        return;
    }

    if (isDocumentRequest(request)) {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(request);
                try {
                    const cache = await caches.open(SHELL_CACHE);
                    await cache.put("/index.html", fresh.clone());
                } catch (error) {
                    // ignore cache write failures
                }
                return fresh;
            } catch (error) {
                const cached = await caches.match("/index.html");
                if (cached)
                    return cached;
                throw error;
            }
        })());
        return;
    }

    if (isLibRequest(url)) {
        event.respondWith((async () => {
            try {
                const cached = await caches.match(request);
                if (cached)
                    return cached;
            } catch (error) {
                // ignore cache read failures
            }
            const fresh = await fetch(request);
            try {
                if (fresh && (fresh.ok || fresh.type === "opaque")) {
                    const cache = await caches.open(LIB_CACHE);
                    await cache.put(request, fresh.clone());
                }
            } catch (error) {
                // ignore cache write failures
            }
            return fresh;
        })());
    }
});
