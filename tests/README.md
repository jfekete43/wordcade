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

That runs the seven suites that need no emulator, then boots the emulator for
the other five, and shuts the emulator down
again. A non-zero exit means something failed.

Two suites drive a real browser instead of the emulator, so they are not part
of `npm test`:

```
cd tests
npm install                     # first time only
npx playwright install chromium # first time only
npm run test:browser
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

**`gauntlet-countdown.test.mjs`** — the "Next in 6h 12m" clock on the Gauntlet
headline card. A Gauntlet day runs midnight-to-midnight in America/New_York, so
the trap is DST: on the two transition days an ET day is 23 or 25 hours long,
and counting the seconds left on the ET *wall clock* puts the countdown a full
hour out (in opposite directions, twice a year). The card resolves a real
instant instead, and these cases pin the elapsed time across both transitions
and both standard offsets, with "now" injected so they assert on fixed instants
rather than on whenever the suite runs. It also pins the assumption behind the
single offset lookup — that the naive timestamp and the answer share a UTC
offset, which holds for ET because the switch is at 02:00 local. Pure, so it
needs no emulator.

**`leaderboard-bests.test.mjs`** — the denormalised `bestRunScore` /
`bestGauntletScore` on the user doc, and the two boards now built on them. Half
of it runs the real bookkeeping extracted from `onRunCreated`'s transaction
against fake run/user pairs (a worse run must not overwrite, a Gauntlet run
advances both bests, a standard run never touches the Gauntlet one, a corrupt
stored value is treated as zero rather than NaN). The other half seeds the
emulator and checks the boards themselves — including the case that motivated
all of this: **two different players sharing a display name now both appear**,
because one row per player is a property of the query rather than something a
dedup pass patches up afterwards. Also checks that a player with no runs stays
off the board rather than being seated at zero, and that the counted rank
matches the row actually rendered.

**`gauntlet-share.test.mjs`** — the share text. Pins the result line (a flat
`8/10` replaced a per-word emoji grid and a three-branch result line; missing a
word ends the run on the spot, so solving 8 *means* you went out on word 9, and
the old "solved N of 10" branch was unreachable), and pins the link onto its own
line. That last one was a real bug: `navigator.share({text, url})` lets the
receiving app join the two however it likes — in practice with a space — so the
URL ran onto the end of the last line in Discord. The URL now travels inside the
shared text, and the suite asserts the native-sheet and clipboard paths produce
byte-for-byte the same string. Pure, so it needs no emulator.

**`gauntlet-done-surface.test.mjs`** — the screen you get when today's Gauntlet
is already finished. There is nothing left to type, but dismissing the end modal
used to leave an empty board and a live keyboard above a header still reading
"WORD 1/10 · SCORE: 0" — a screenful of dead space above the standings the
player came back to see. The risk in the hide/restore pair that fixes it is the
*restore*: the display values are written as literals, so a stylesheet change
would bring an element back with the wrong layout and nothing would visibly
break. This runs the real function against the real markup and stylesheet in
Chromium, and compares the restored layout against pristine copies rather than
against those literals. Needs Playwright.

**`shop-order.test.mjs`** — shop pricing order. `SHOP_ITEMS` is written in the
order items were designed, so every late addition landed out of price order in
the grid; four of them had by the time it was noticed. `renderShop` sorts a copy
by cost instead, so a new item can never be in the wrong slot again. Checks
every category comes out ascending, that same-price items keep their declared
order (the sort is stable), that the catalogue itself is *not* reordered — it is
looked up by id from several other places, including the Cloud Function's copy —
and names the four that were previously misplaced, so a regression names itself.
Pure.

**`profile-ui.test.mjs`** — the placement badges and the Profile modal's tabs.
The badges replaced a 📊 emoji with drawn SVG, because an emoji renders in
whatever style the viewer's OS ships and lands differently on every device. The
mapping has two boundaries that are easy to put one off (3rd/4th, 10th/11th) and
the markup gets concatenated into an `innerHTML` string beside player-supplied
text, so it is checked for being inert and self-contained with no reused
gradient ids. The tab switcher replaced two inline handlers that each had to
name the other panel — a shape that does not survive a third tab — so the tests
assert exactly one panel visible and one tab active through every transition,
and that reopening the Gauntlet tab re-reads rather than serving stale numbers.
Pure.

**`word-difficulty.test.mjs`** — the grading that shapes a Gauntlet, and the
validation guarding it. Per-word samples ride along on the client-written
`/runs` document, and `firestore.rules` can only bound the array's size (a list
of maps cannot be inspected element by element there), so `foldRunWordLog`
re-checks every entry against the real target list and counts a word once per
run. Poisoning it would move no points and no money, but it would quietly skew
which words the Gauntlet thinks are hard — so the rejection cases are the bulk
of this suite. Also covers the shrinkage in `effectiveDifficulty` (a word seen
twice must barely move off its computed score) and `pickDailyWords` (ten unique
real words, always ordered easiest to hardest, with a real spread). Pure.

**`pwa.test.mjs`** — `sw.js` and `site.webmanifest`. Serves the repo over
localhost in a headless Chromium and checks the things that make the game
installable (a parseable manifest with `start_url`, both icon sizes, a worker
that registers and takes control, and a maskable icon that is opaque and keeps
its artwork inside the centre 80% safe zone — without one Android letterboxes
the icon on a white circle, with a full-bleed one it crops the logo, and both
look fine in the manifest and only show up on a phone) *and*, more importantly, the things the
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
