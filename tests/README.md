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

Both leaderboard suites extract the **real functions out of `index.html`** and
execute those, rather than a copy that could drift from what actually ships.
