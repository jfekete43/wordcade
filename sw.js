/*
 * Lexathon service worker.
 *
 * Its job is installability and a usable offline shell — NOT aggressive
 * caching. Lexathon is a live game: leaderboards, Clash, FFA and the live
 * feed are all Firestore realtime traffic, and serving any of that from a
 * cache would be actively wrong. So the rules here are deliberately narrow:
 *
 *   - Anything cross-origin (Firebase, Google Fonts, AdSense, gstatic) is
 *     left completely alone. We do not even call respondWith on it, which
 *     keeps streaming, CORS and auth redirects exactly as the browser
 *     would do them with no service worker installed.
 *   - Same-origin page navigations are network-first, so a fresh deploy of
 *     index.html reaches players on their next load instead of being
 *     pinned to whatever was cached. The cache is only the offline
 *     fallback.
 *   - Same-origin static assets (words.js, icons, the manifest) are
 *     cache-first with a background refresh, because they are big and they
 *     change rarely. A word-list change lands on the load after the one
 *     that fetched it.
 *
 * Bump CACHE_VERSION whenever the precache list changes; activate deletes
 * every cache that is not the current one.
 */
const CACHE_VERSION = "lexathon-v1";

// Kept small on purpose: enough to boot the game offline, nothing more.
//
// Note "/" and not "/index.html": the server answers both with the same file,
// but they are two separate cache keys, and only the one actually navigated to
// gets refreshed. Precaching both would leave a permanently stale second copy
// that the offline fallback could pick up. "/" is the one navigations use, so
// "/" is the one we keep.
const PRECACHE_URLS = [
    "/",
    "/words.js",
    "/site.webmanifest",
    "/favicon.ico",
    "/icon-192.png",
    "/icon-512.png",
    "/apple-touch-icon.png",
    "/how-to-play.html",
    "/strategy.html",
    "/faq.html",
    "/about.html",
    "/privacy.html",
    "/terms.html"
];

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        // addAll() is all-or-nothing: one 404 would fail the whole install
        // and leave the site with no service worker at all. Precaching is a
        // nice-to-have, so each URL is allowed to fail on its own.
        await Promise.all(PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        ));
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => key === CACHE_VERSION ? null : caches.delete(key)));
        await self.clients.claim();
    })());
});

// Pages can ask the waiting worker to take over immediately after an update.
self.addEventListener("message", (event) => {
    if (event.data === "skip-waiting") self.skipWaiting();
});

function isStaticAsset(url) {
    return /\.(?:js|css|png|jpg|jpeg|svg|ico|webmanifest|woff2?)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Cross-origin: Firebase, AdSense, fonts. Not ours to touch.
    if (url.origin !== self.location.origin) return;

    // Anything carrying a query string is treated as dynamic (share links,
    // ?match= auto-join URLs, cache-busted assets) and goes straight to the
    // network so it never gets answered from a stale cache entry.
    if (url.search) return;

    if (request.mode === "navigate") {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(request);
                const cache = await caches.open(CACHE_VERSION);
                cache.put(request, fresh.clone());
                return fresh;
            } catch (err) {
                // Offline. Serve this exact page if we have it, otherwise the
                // app shell — index.html is the whole game, so that is a real
                // fallback and not an error page.
                const cached = await caches.match(request);
                if (cached) return cached;
                const shell = await caches.match("/");
                if (shell) return shell;
                return new Response(
                    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Lexathon — Offline</title>" +
                    "<style>body{background:#121213;color:#ccc;font-family:sans-serif;text-align:center;padding:60px 20px}" +
                    "h1{color:#ff9800;font-style:italic;text-transform:uppercase}</style></head>" +
                    "<body><h1>Offline</h1><p>Lexathon can't reach the network right now. " +
                    "Reconnect and try again.</p></body></html>",
                    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
                );
            }
        })());
        return;
    }

    if (!isStaticAsset(url)) return;

    event.respondWith((async () => {
        const cached = await caches.match(request);
        const network = fetch(request).then((response) => {
            if (response && response.ok) {
                caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
            }
            return response;
        }).catch(() => cached);
        // Cache-first, but the network copy still lands in the cache for the
        // next load, so a deployed asset change is never more than one visit
        // behind.
        return cached || network;
    })());
});
