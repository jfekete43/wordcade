# Tests

Regression tests that run against a **local Firestore emulator**. They never
touch the live `wordcade-387e8` project — the emulator runs under the project
id `demo-wordcade-test`, and Firebase treats any `demo-` prefixed project as
guaranteed-offline, so these cannot reach production data even by accident.

## Running them

Needs Node and Java (the Firestore emulator is a Java process). Google Cloud
Shell has both already, which is the easiest place to run these.

```
cd tests
npm install     # first time only
npm test
```

That boots the emulator, runs all three suites, and shuts the emulator down
again. A non-zero exit means something failed.

The PWA suite is separate — it drives a real browser instead of the emulator,
so it is not part of `npm test`:

```
cd tests
npm install                     # first time only
npx playwright install chromium # first time only
npm run test:pwa
```

## What each suite covers

**`rules.test.mjs`** — `firestore.rules`. Confirms the stored-XSS vectors stay
closed (markup in a run's `username`, markup in `equipped`, unknown keys, wrong
types, an over-long name) *and*, just as importantly, that legitimate traffic
still works: equipping a real cosmetic, a legacy profile whose loadout is
missing keys, a normal run save, and an accented display name from Google
sign-in. Also re-checks the standing rule that a client can't write `wallet`
directly.

**`leaderboard.test.mjs`** — the duplicate-name bug. Seeds the exact scenario
that produced "SODA" three times on the board: one player with several runs
saved under *different* historical names, plus two separate accounts that
currently share one display name, plus a run whose account has been deleted.
Asserts each player appears exactly once, at their best score, in score order.

**`leaderboard-chunking.test.mjs`** — the same pipeline at 75 players, which
forces the batched lookup to split into multiple queries (Firestore allows at
most 30 ids per `in` filter). If a chunk were ever silently dropped, those
players would fall back to stale names and reappear as duplicates — this is
the test that would catch it.

**`pwa.test.mjs`** — `sw.js` and `site.webmanifest`. Serves the repo over
localhost in a headless Chromium and checks the things that make the game
installable (a parseable manifest with `start_url`, both icon sizes, a worker
that registers and takes control) *and*, more importantly, the things the
worker must **not** do: cache a cross-origin response, cache a URL with a
query string, keep a second copy of the shell that could go stale, or pin
players to an old build. The freshness check fakes a deploy and asserts the
new page arrives on the very next load; the offline check tears the server
down completely rather than emulating offline, because Playwright's offline
mode and request routing don't reliably cover a service worker's own fetches
— an "offline" test built on those can quietly pass on the network instead of
the cache.

Both leaderboard suites extract the **real functions out of `index.html`** and
execute those, rather than a copy that could drift from what actually ships.
