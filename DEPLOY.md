# Deploying the Cloud Functions + Firestore rules

This covers `functions/`, `firestore.rules` and `firestore.indexes.json` — the
server-side pieces that
validate score/wallet/mmr instead of trusting the client. The static site
(`index.html`) is unaffected by any of this and keeps deploying however it
already does (e.g. GitHub Pages via `CNAME`).

---

## The everyday deploy (start here)

Most of the time this is all you need. The one-time setup is further down and
only matters on a machine that has never deployed before.

Open **Google Cloud Shell** — [shell.cloud.google.com](https://shell.cloud.google.com),
or the `>_` icon in the top-right of the Google Cloud console — with the
project set to `wordcade-387e8`. Then:

```bash
cd wordcade            # if it is not there: git clone https://github.com/jfekete43/wordcade.git
git pull origin main
firebase deploy --only firestore:indexes,firestore:rules,functions --project wordcade-387e8
```

**That order is deliberate.** Indexes build asynchronously and a query has no
index to use until its build finishes, so they go first. Rules are instant.
Functions take a few minutes and are the thing most likely to need a retry.

**Pull before you deploy.** Cloud Shell keeps its own copy of the repo, and it
does not update itself. Deploying a stale copy pushes old code back out over
the current one — this is the single easiest way to undo working changes.

To confirm the pull actually landed before deploying:

```bash
git log --oneline -1
```

That should match the newest commit on
[github.com/jfekete43/wordcade](https://github.com/jfekete43/wordcade/commits/main).

### Deploying only one piece

```bash
firebase deploy --only firestore:indexes --project wordcade-387e8  # indexes only
firebase deploy --only firestore:rules --project wordcade-387e8    # security rules only
firebase deploy --only functions --project wordcade-387e8          # cloud functions only
```

Rules and indexes deploy in seconds — but an index *build* runs in the
background afterwards and can take minutes on a collection with history in it.
Watch it in Firebase Console → **Firestore** → **Indexes**; a query whose index
is still building fails with `FAILED_PRECONDITION` until it goes green.
Functions take a few minutes to deploy.

### When a deploy is actually needed

| Changed file | Needs a deploy? |
| --- | --- |
| `index.html`, `words.js`, `privacy.html`, `terms.html` | **No** — GitHub Pages serves these straight from `main`, live within a minute of the push |
| `functions/index.js`, `functions/*.json` | **Yes** — `--only functions` |
| `firestore.rules` | **Yes** — `--only firestore:rules` |
| `firestore.indexes.json` | **Yes** — `--only firestore:indexes` |
| `tests/`, `tools/`, `DEPLOY.md` | **No** — never shipped anywhere |

### If it errors

- `Cloud Functions V2 regions are currently unreachable: us-central1` — a
  transient Google-side blip, nothing to do with the code. Run it again.
- Several functions fail with `Failed to make request` while others succeed —
  Cloud Functions API throttling, not a build error. Re-run the same command;
  it only redeploys what changed, so it costs nothing to retry.

  **Then test every function that was in the failed batch.** A retry that
  reports `Successful update operation` is not proof the function works. In
  2nd-gen each function is its own Cloud Run service, and `firebase deploy`
  only creates a new *revision* of it — so a service left half-created by the
  original failure keeps accepting deploys while 500-ing every single
  invocation. This cost days once: `startFfaMatch` looked deployed, took three
  more successful deploys, and failed every call throughout.

  The tell is a callable failing with a bare `internal` and no application
  message. Every deliberate rejection in this codebase carries its own code
  (`failed-precondition`, `permission-denied`, …) and `startFfaMatch` wraps
  unexpected throws with a real message, so a naked `internal` means the
  handler never ran at all.

  An update cannot fix it. Delete and redeploy, which forces a brand-new
  service and re-applies its invoker permissions from scratch:

  ```bash
  firebase functions:delete <name> --project wordcade-387e8 --force
  firebase deploy --only functions:<name> --project wordcade-387e8
  ```

  Safe for callables (stateless, recreated in seconds). For a background
  trigger it also means events in the gap aren't delivered — a few seconds at
  this traffic.
- `FAILED_PRECONDITION: The query requires an index` — the index deploy has
  landed but its build has not finished. Wait for it to go green in Firebase
  Console → Firestore → Indexes.
- `Error: Failed to authenticate` — run `firebase login --no-localhost` and
  follow the printed link.
- Anything else — the error text is usually specific; keep it, it is what
  someone would need to diagnose the problem.

---

## One-time setup

### Enable the Blaze plan

Cloud Functions requires Firebase's Blaze (pay-as-you-go) plan — Firestore
alone does not. This step needs to be done by the project owner in the
Console; no CLI command can do it on your behalf.

1. [console.firebase.google.com](https://console.firebase.google.com) →
   select **wordcade-387e8**.
2. Gear icon (bottom-left) → **Usage and billing** → **Modify plan**.
3. Select **Blaze**, attach a billing account, confirm.

A game at this scale should comfortably sit within Cloud Functions' free
monthly quota (2M invocations, 400K GB-seconds compute) — expect $0/mo
unless usage grows dramatically.

### Install the Firebase CLI and authenticate

```bash
npm install -g firebase-tools
firebase login
```

### Install function dependencies

```bash
cd functions
npm install
cd ..
```

### First deploy

```bash
firebase deploy --only firestore:indexes,firestore:rules,functions --project wordcade-387e8
```

All 20 functions should deploy successfully: `onRunCreated`,
`onMatchFinished`, `finishClashMatch`, `forfeitClashMatch`, `claimChallenge`,
`purchaseItem`, `changeUsername`, `refreshProfile`, `generateDailyPuzzle`,
`aggregateWordStats`, `startDailyGauntlet`, `guessDailyWord`,
`startSuddenDeath`, `guessSuddenDeathWord`, `resolveSuddenDeathTimeout`,
`joinFfaMatch`, `leaveFfaMatch`, `startFfaMatch`, `finishFfaMatch`,
`onFfaMatchFinished`.

Two of those are on a schedule rather than called by the game:
`generateDailyPuzzle` at 00:00 Eastern and `aggregateWordStats` at 01:30.

(If you are reading an older copy of this file with a smaller count, it was
written before Clash sudden-death, the Daily Gauntlet, FFA or word-difficulty
tracking existed.)

Note: this repo's `firebase.json` intentionally has no `hosting` section
(the site is served via GitHub Pages, not Firebase Hosting) — running
`firebase deploy` without `--only` would try to deploy hosting too and is
not what you want here.

## Running the tests first (optional, and the same in Cloud Shell)

Cloud Shell has Node and Java, which is everything the emulator suite needs:

```bash
cd tests
npm install        # first time only
npm test           # rules + leaderboard + gauntlet + difficulty suites
cd ..
```

A non-zero exit means something is broken; deploying anyway is how a bad rule
reaches production.

## Verifying a deploy

- Play a round, cash out, buy a shop item, claim a challenge, change your
  handle — all should work exactly as before from the player's side.
- Firebase Console → **Functions** → a function → **Logs** should show
  invocations as you do those actions.
- Firebase Console → **Functions** → `aggregateWordStats` → **Logs**, after
  01:30 Eastern. It logs how many word samples it counted and how many it
  rejected. A handful of rejections is normal; a flood means something is
  sending junk.
- Firestore Console → a test user's `users/{uid}` doc → `wallet` /
  `careerBank` / `mmr` should only change *after* the corresponding
  in-game action completes (a brief delay is normal — it's now a network
  round-trip to a Cloud Function instead of an instant local write).

## Rolling back

If something goes wrong, the previous (client-writes-everything) rules and
code are just the previous git commit — `firebase deploy --only
firestore:rules` after checking out the prior commit restores the old
rules. There's no equivalent "roll back" for functions other than
re-deploying an older commit's `functions/` the same way; Cloud Functions
also keeps its own version history in the Console under each function if
you need to roll back without touching git.

## The Gauntlet archive (`/gauntlet/`)

Static pages, one per finished Gauntlet, built from Firestore and committed
to the repo. GitHub Pages serves them — **no Firebase deploy is involved**.

### One-time setup

1. Create a service-account key in Firebase Console → Project Settings →
   Service accounts → **Generate new private key**.
2. Paste the whole JSON into a GitHub repo secret named
   `FIREBASE_SERVICE_ACCOUNT` (Settings → Secrets and variables → Actions).
3. Settings → Actions → General → Workflow permissions → **Read and write**,
   so the daily job can commit what it builds.

### The first backfill

Run it once by hand from Cloud Shell, where you are already authenticated:

```bash
cd ~/wordcade && git pull origin main
npm install --no-save firebase-admin
node tools/build-gauntlet-archive.mjs --all --dry-run   # look first
node tools/build-gauntlet-archive.mjs --all
git add gauntlet sitemap.xml && git commit -m "Backfill Gauntlet archive" && git push
```

### Which days get a page

A day nobody finished renders as ten words and "Nobody finished this one",
and it can never improve — a past Gauntlet cannot be played retroactively,
so its run count is final once the day ends. Those pages stay thin forever,
so **days with no finishers are skipped by default**.

`--min-players=N` changes the bar; `--min-players=0` publishes everything.
Raising it later and re-running with `--all` deletes the pages that no
longer qualify, so the hub and sitemap stay in step:

```bash
node tools/build-gauntlet-archive.mjs --all --min-players=3 --dry-run
```

Pruning only happens on `--all`, because only a full run knows the whole
set. And a full run that built *nothing* against a non-empty archive
refuses rather than deleting it — a transient Firestore failure looks
exactly like "no day qualifies", and only one of those should wipe the
archive.

After that the `Build Gauntlet archive` workflow runs daily at 07:30 UTC and
commits yesterday's page by itself. `--all` is also available from the
Actions tab (Run workflow → tick "Rebuild every past day") if a template
change means every page needs regenerating.

### The rule that matters

The generator will not publish a date unless it is strictly before today in
**Eastern** time, because today's answers are still live. That check is in
`tools/gauntlet-archive-render.mjs` (`isPublishable`) and is covered on both
DST transition days by `tests/gauntlet-archive-pages.test.mjs`. If you ever
change the scheduling, do not weaken it — a mistimed run should produce
nothing, which it does.

### Cost

Per day: one `dailyPuzzles` read, one `runs` query, and one `dailyAttempts`
read per player who finished. No collection-group query, so no extra index.
