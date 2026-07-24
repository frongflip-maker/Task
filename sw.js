const SW_VERSION = "taskroutine-sw-2";
const SHELL_CACHE = `${SW_VERSION}-shell`;
const LIB_CACHE = `${SW_VERSION}-lib`;
const LIB_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"];
const MATCH_OPTIONS = { ignoreVary: true };

/* Libraries the app needs before it can boot. Precached at install time so the
   very first offline launch works instead of needing a second online visit. */
const PRECACHE_LIBS = [
    "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js",
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.3",
    "https://cdn.jsdelivr.net/npm/lucide@1.24.0/dist/umd/lucide.min.js"
];

async function precacheShell() {
    try {
        const cache = await caches.open(SHELL_CACHE);
        const response = await fetch("/index.html", { cache: "reload" });
        if (response && response.ok)
            await cache.put("/index.html", response.clone());
    } catch (error) {
        // offline at install time; runtime caching fills this in later
    }
}

async function precacheLibs() {
    let cache;
    try {
        cache = await caches.open(LIB_CACHE);
    } catch (error) {
        return;
    }
    await Promise.all(PRECACHE_LIBS.map(async url => {
        try {
            const existing = await cache.match(url, MATCH_OPTIONS);
            if (existing)
                return;
            const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "reload" });
            if (response && response.ok)
                await cache.put(url, response.clone());
        } catch (error) {
            // one library failing must never block install
        }
    }));
}

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil((async () => {
        await precacheShell();
        await precacheLibs();
    })());
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
    if (type === "SW_WARM") {
        event.waitUntil((async () => {
            await precacheShell();
            await precacheLibs();
            try {
                const port = event.ports && event.ports[0];
                if (port) {
                    const shell = !!(await caches.match("/index.html", MATCH_OPTIONS));
                    const cache = await caches.open(LIB_CACHE);
                    const entries = await Promise.all(PRECACHE_LIBS.map(url => cache.match(url, MATCH_OPTIONS)));
                    port.postMessage({ shell, libs: entries.filter(Boolean).length, total: PRECACHE_LIBS.length, version: SW_VERSION });
                }
            } catch (error) {
                // ignore reporting failures
            }
        })());
    }
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    event.waitUntil((async () => {
        try {
            const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            const target = all.find(client => client.url.includes(self.location.origin));
            if (target) {
                await target.focus();
                return;
            }
            await self.clients.openWindow("/");
        } catch (error) {
            // nothing else we can do
        }
    })());
});

const isDocumentRequest = request =>
    request.mode === "navigate" || request.destination === "document";

const isLibRequest = url => LIB_HOSTS.includes(url.hostname);

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
                const cached = await caches.match("/index.html", MATCH_OPTIONS);
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
                const cached = await caches.match(request, MATCH_OPTIONS);
                if (cached)
                    return cached;
            } catch (error) {
                // ignore cache read failures
            }
            const fresh = await fetch(request);
            try {
                if (fresh && fresh.ok) {
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
