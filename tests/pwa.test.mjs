/*
 * PWA regression tests: the service worker and the web app manifest.
 *
 * These are what make Lexathon installable ("Add to Home Screen") and give it
 * an offline shell. The risk they guard against is not "the worker fails to
 * install" — it is the opposite: a worker that caches too eagerly and starts
 * serving players a stale build, or intercepting Firebase traffic that has to
 * stay live. So most of the checks below are about what sw.js must NOT do.
 *
 * Unlike the other suites here, this one needs Playwright and Chromium rather
 * than the Firestore emulator:
 *
 *     cd tests && npm install && npx playwright install chromium
 *     node pwa.test.mjs
 *
 * It serves the repo over http://127.0.0.1 from an in-process server (service
 * workers are allowed on localhost without TLS) and never writes to the repo.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8907;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"
};

// Lets a test pretend a new build was deployed without touching the repo.
let overrides = new Map();

const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
    if (overrides.has(pathname)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(overrides.get(pathname));
    }
    const rel = pathname === "/" ? "/index.html" : pathname;
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end("not found");
    }
    res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store"
    });
    fs.createReadStream(file).pipe(res);
});

const results = [];
const check = (ok, name, detail = "") => results.push([ok, name, detail]);

let browser;
try {
    // Prefer a local install; fall back to a globally installed Playwright so
    // this can be run without adding node_modules to the repo.
    let chromium;
    try {
        ({ chromium } = await import("playwright"));
    } catch (e) {
        const { execSync } = await import("node:child_process");
        const root = execSync("npm root -g", { encoding: "utf8" }).trim();
        ({ chromium } = await import(path.join(root, "playwright", "index.mjs")));
    }
    await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

    const launch = {};
    // The dev container ships a prebuilt Chromium; elsewhere Playwright's own
    // download is used.
    if (fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
    browser = await chromium.launch(launch);
    const ctx = await browser.newContext();
    // Keep Firebase/AdSense/fonts off the wire: `load` (and therefore the
    // worker registration) shouldn't wait on third parties, and the test is
    // about our own origin.
    await ctx.route("**/*", (route) =>
        route.request().url().startsWith(ORIGIN) ? route.continue() : route.abort());
    const page = await ctx.newPage();

    // --- registration -----------------------------------------------------
    await page.goto(ORIGIN + "/", { waitUntil: "load" });
    const reg = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        // `ready` can resolve while activate (clients.claim) is still running.
        if (r.active && r.active.state !== "activated") {
            await new Promise((res) => {
                const t = setTimeout(res, 3000);
                r.active.addEventListener("statechange", () => {
                    if (r.active.state === "activated") { clearTimeout(t); res(); }
                });
            });
        }
        return { scope: r.scope, state: r.active && r.active.state };
    });
    check(reg.state === "activated", "service worker registers and activates", JSON.stringify(reg));
    check(reg.scope === ORIGIN + "/", "worker scope covers the whole site", reg.scope);

    await page.reload({ waitUntil: "load" });
    check(await page.evaluate(() => !!navigator.serviceWorker.controller),
        "second load is controlled by the worker");

    // --- manifest / installability ---------------------------------------
    const cdp = await ctx.newCDPSession(page);
    const m = await cdp.send("Page.getAppManifest");
    const d = m.data ? JSON.parse(m.data) : {};
    const sizes = (d.icons || []).map((i) => i.sizes);
    check((m.errors || []).filter((e) => e.critical).length === 0,
        "manifest parses with no critical errors", JSON.stringify(m.errors || []));
    check(!!d.start_url, "manifest declares start_url (required to install)", d.start_url);
    check(!!d.name && !!d.short_name, "manifest has name and short_name", d.short_name);
    check(d.display === "standalone", "manifest display is standalone", d.display);
    check(sizes.includes("192x192") && sizes.includes("512x512"),
        "manifest has both a 192px and a 512px icon", sizes.join(","));

    // --- what got cached --------------------------------------------------
    const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        const c = await caches.open(names[0]);
        return { names, urls: (await c.keys()).map((r) => new URL(r.url).pathname).sort() };
    });
    check(cached.names.length === 1 && cached.names[0].startsWith("lexathon-v"),
        "exactly one versioned cache (old ones are cleaned up)", JSON.stringify(cached.names));
    check(["/", "/words.js", "/icon-192.png", "/faq.html", "/how-to-play.html"]
        .every((p) => cached.urls.includes(p)),
        "precached the shell, the word list, icons and content pages", cached.urls.join(" "));
    // "/" and "/index.html" are the same file but different cache keys, and
    // only the navigated one gets refreshed — caching both would leave a
    // permanently stale copy for the offline fallback to find.
    check(!cached.urls.includes("/index.html"),
        "no duplicate /index.html entry that could go stale", cached.urls.join(" "));

    check(await page.evaluate(() => Array.isArray(window.allValidWords) && window.allValidWords.length > 1000),
        "words.js still loads with the worker in control");

    // --- the worker must leave live traffic alone -------------------------
    await ctx.unroute("**/*");
    const foreign = await page.evaluate(async () => {
        try { await fetch("https://firestore.googleapis.com/ping", { mode: "no-cors" }); } catch (e) { /* offline in CI is fine */ }
        const names = await caches.keys();
        const c = await caches.open(names[0]);
        return (await c.keys()).filter((r) => !r.url.startsWith(location.origin)).map((r) => r.url);
    });
    check(foreign.length === 0,
        "no cross-origin response is ever cached (Firebase/ads stay live)", foreign.join(" "));

    const qs = await page.evaluate(async () => {
        const names = await caches.keys();
        const c = await caches.open(names[0]);
        return (await c.keys()).filter((r) => new URL(r.url).search).map((r) => r.url);
    });
    check(qs.length === 0,
        "no query-string URL is cached (share and auto-join links stay live)", qs.join(" "));

    // --- a new deploy must not be pinned behind the cache -----------------
    await ctx.route("**/*", (route) =>
        route.request().url().startsWith(ORIGIN) ? route.continue() : route.abort());
    const shipped = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    overrides.set("/", shipped.replace(/<title>[^<]*<\/title>/, "<title>DEPLOYED BUILD 2</title>"));
    await page.reload({ waitUntil: "load" });
    const afterDeploy = await page.title();
    check(afterDeploy === "DEPLOYED BUILD 2",
        "a fresh deploy reaches the player on the very next load", afterDeploy);
    await page.waitForTimeout(600); // let the navigation response land in the cache

    // --- genuinely offline ------------------------------------------------
    // The server is torn down rather than emulated: Playwright's offline mode
    // and request routing don't reliably cover the service worker's own
    // fetches, so an "offline" test using those can silently pass on the
    // network instead of the cache.
    await new Promise((r) => server.close(r));
    let serverGone = false;
    try { await fetch(ORIGIN + "/"); } catch (e) { serverGone = true; }
    check(serverGone, "server really is down for the offline phase");

    await page.goto(ORIGIN + "/", { waitUntil: "domcontentloaded" }).catch(() => {});
    const offline = await page.evaluate(() => ({
        title: document.title,
        words: Array.isArray(window.allValidWords) ? window.allValidWords.length : 0,
        keys: document.querySelectorAll(".key, #keyboard button").length
    })).catch((e) => ({ err: e.message }));
    check(offline.title === "DEPLOYED BUILD 2",
        "offline serves the newest cached page, not the precached one", offline.title);
    check(offline.words > 1000, "offline page still has the full word list", "allValidWords=" + offline.words);
    check(offline.keys > 20, "offline page still renders the game UI", "keys=" + offline.keys);
} finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise((r) => server.close(r));
}

let failed = 0;
for (const [ok, name, detail] of results) {
    if (!ok) failed++;
    console.log((ok ? "PASS" : "FAIL").padEnd(6) + name + (!ok && detail ? "  -> " + detail : ""));
}
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nAll ${results.length} passed`);
process.exit(failed ? 1 : 0);
