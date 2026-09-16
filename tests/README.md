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

That runs the two suites that need no emulator, then boots the emulator for
the other four, and shuts the emulator down
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

**`gauntlet-standing.test.mjs`** — the placement math behind the "you finished
12th of 47" callout. Placement is counted (runs scoring above you, plus one)
rather than read off a list, so ties are the thing most likely to be quietly
wrong: two players on the same score must share a place and the next player
down must skip one. It also seeds a standard-mode run tagged with the same
date and a second Gauntlet for the same player, both of which must be excluded
— a standard run routinely outscores a Gauntlet, so a dropped `mode` filter
would take first place and inflate the field size. Exactness rests on daily
runs living at a deterministic `runs/daily_{uid}_{date}` id, which caps a
player at one run per puzzle date.

**`gauntlet-feed.test.mjs`** — the renderer for today's Gauntlet board, the
scrolling list under the play area. Two things there are easy to get quietly
wrong. Placement numbering has to give ties a shared place and skip the next
score (1, 2, 2, 4) so the board agrees with the "you finished 12th of 47"
callout, which arrives at its number a completely different way. And this is
the one board with **no dedup pass** — every other board collapses rows by
display name because a player can hold many runs, but a Gauntlet caps a player
at one run per day, so a dedup here could only ever collapse two *different*
players who share a handle, and erase the viewer from their own board if one of
them were them. Also covers the usual hostile `username`/`equipped` payloads.
Pure, so it needs no emulator.

**`gauntlet-archive.test.mjs`** — the "Past Gauntlets" date list. The list of
playable dates is *derived*, not queried: `/dailyPuzzles` holds the answer words
and is `read: if false`, so the archive walks backwards from yesterday with
`GAUNTLET_EPOCH` as the floor. That leaves two ways to generate entries that
load an empty board — walking back past Gauntlet #1 into dates that never
existed, and including today, whose board is still live and not final. Both are
pinned here, along with paging, the day-one empty state, and year and leap-day
boundaries. Pure, so it needs no emulator.

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
