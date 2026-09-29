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

## One command (and deploying from a phone)

```bash
cd ~/wordcade && bash tools/deploy.sh
```

That pulls, deploys indexes then functions, and then offers the weekly-board
backfill and the old-match sweep one at a time, showing you a dry run of each
before it asks. It stops at the first failure and nothing destructive happens
without a y.

```bash
bash tools/deploy.sh --deploy   # deploy only, skip the data steps
bash tools/deploy.sh --yes      # no prompts
```

**On a phone this is the only practical route**, because Cloud Shell's web
terminal will not let you paste — it reads keystrokes through a hidden textarea
the browser refuses to let scripts read from the clipboard. The script exists so
that a full deploy is one short line you can thumb in rather than five long ones.

The first time (the script has to exist in your clone before you can run it):

```bash
cd ~/wordcade && git pull origin main && bash tools/deploy.sh
```

Every time after, the script does its own pull.

**Keep the tab in the foreground.** Cloud Shell drops the session when a mobile
browser backgrounds it, and the functions step takes a few minutes. If it does
drop, nothing is broken — run it again; anything already current is skipped.

To save typing it at all, once:

```bash
echo "alias dep='cd ~/wordcade && bash tools/deploy.sh'" >> ~/.bashrc
```

Then it is just `dep`. Cloud Shell's home directory persists, so that survives.

## Analytics

Cloudflare Web Analytics, chosen over Google Analytics because it is cookieless:
it sets no cookies and stores no personal data, so the site needs **no consent
banner**. GA would have meant a cookie wall on the landing page of a game whose
pitch is "click and play".

**No deploy is involved** — these are static pages, live within a minute of the
push.

### Turning it on

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free; you do
   **not** need to move your DNS).
2. **Analytics & Logs → Web Analytics → Add a site**, enter `lexathon.gg`.
3. Copy the token out of the snippet it shows you (the value inside
   `data-cf-beacon='{"token":"…"}'`).
4. Stamp it into every page at once:

```bash
node tools/set-analytics-token.mjs <token>
node tools/set-analytics-token.mjs --status    # confirm 8 live, 0 pending
git add -A && git commit -m "Turn on analytics" && git push
```

5. Give it ~30 minutes.

`--off` puts every page back to the pending comment; `--status` says what each
one currently has.

### Why a tool rather than find-and-replace

Eight files carry the block: the seven static pages, plus the shared `head()` in
`tools/gauntlet-archive-render.mjs`, which covers **every generated Gauntlet
archive page**. Those archive pages are the ones in `sitemap.xml`, so they are a
real way in — and because they come out of a renderer rather than the repo, they
are exactly the ones a manual edit misses. The failure is silent: the page just
reports no traffic. `tests/docs-consistency` fails if any file is missing the
block, if only some are live, or if two tokens are in use.

The archive pages pick up a token change on the next daily rebuild, or
immediately with `node tools/build-gauntlet-archive.mjs --all`.

### What it does not cover

Gameplay. How many people finished the Gauntlet, how far runs get, which modes
get played — all of that is already in Firestore, and a query over your own data
answers it better than event tracking would. This is only for acquisition: how
many people arrived, and from where.

### If you ever add AdSense

AdSense and Analytics are separate products; AdSense has never required GA. But
personalised ads need a certified consent platform for EEA/UK traffic, so the
cookie banner arrives **with AdSense**, not with analytics. At that point adding
GA is a marginal extra. Nothing here locks you out. Re-check Google's current
publisher requirements when you actually apply.

## Arcade Handle screening

A handle is the last free text a stranger can put in front of you, and the most
exposed text in the game: leaderboard, live feed, match cards, FFA standings,
and the **static Gauntlet archive pages**, which are committed to the repo and
listed in `sitemap.xml`. `runs` documents also store `username` denormalised, and
both the leaderboard and the archive read it from there — so a slur that gets
through is published to a page search engines index, and **a rename does not
retract it**. That is why this screens at the door rather than relying on reports.

Two doors, both covered, and they are the complete set (firestore.rules lets a
client update nothing but `equipped` on its own profile):

| door | what happens |
| --- | --- |
| `changeUsername` | rejected outright, and the player is told to choose another |
| `onUserProfileCreated` | the seeded handle is replaced with `PLAYER####` |

The second exists because a new profile's handle is written by the client, derived
from the Google display name, so it never passes through `changeUsername`.

**Both are Cloud Functions, so this needs a functions deploy:**

```bash
firebase deploy --only functions
```

The filter is server-side only, deliberately: the term list never ships to a
browser.

### Adding terms

Terms live base64-encoded in `functions/handle-terms.json`. That is obfuscation,
not security — the point is that a public repository should not contain a
greppable list of slurs, which is unpleasant in itself and doubles as a list of
what to work around. You never need the original terms to add more:

```bash
printf 'newterm\n' | node tools/hash-handle-terms.mjs --add
node tools/hash-handle-terms.mjs --list     # review what is stored, decoded
node tools/hash-handle-terms.mjs --audit    # dictionary words the screen refuses
```

**Run `--audit` after any change.** It screens the game's own 12,972-word
dictionary and prints every word refused. Anything innocent in that list belongs
in `EXCEPTIONS` in `functions/handle-filter.js`. `tests/handle-filter` asserts the
count, so a new term will fail the suite until you have looked.

### How matching works

A handle is lowercased, leetspeak is mapped (`n1gg3r`), and everything but a-z is
dropped (`s.l.u.r`). Each term becomes a regex whose every letter may repeat, so
`niiiggerrr` matches while a word one letter short does not. Terms of four
letters or more match anywhere (`xXslurXx` is how one is usually built); shorter
terms match only the whole handle, so three letters cannot ban every handle
containing them. `EXCEPTIONS` masks innocent words that still collide, so `spicy`
passes while `spicyspic` does not.

The first version collapsed repeated letters and matched substrings instead. That
refused 17 dictionary words, six of them innocent, and merged the slur with the
**country Niger** — which no exception list can separate, since both collapse to
the same string. Do not reintroduce collapsing.

## Match cleanup (`matches`)

Match documents were never cleaned up. Only two things ever deleted one — a
host abandoning a lobby, and the client clearing its own stale `waiting` rooms
on the way into matchmaking — so every match that was actually **played** stayed
in Firestore for good, with its chat inside it, in a collection any signed-in
account can read (matchmaking has to query for open lobbies).

The daily **Daily maintenance** workflow now deletes matches older than 24
hours, in the same job as the Gauntlet archive and using the same
`FIREBASE_SERVICE_ACCOUNT` secret. **No Firebase deploy is involved** — but the
`createdAt` field it ages matches by does need the rules deployed, see below.

### Why 24 hours

A match's useful life is minutes: the lobby wait, a race of at most seven
minutes, the end modal, and the rematch hop (the guest follows `rematchMatchId`
off the *finished* doc, so the doc has to outlive the match). 24 hours leaves
room for all of that and for looking into a same-day complaint, and it is the
number `privacy.html` states. It lives in `tools/match-cleanup.mjs` as
`DEFAULT_RETENTION_HOURS`; `tests/docs-consistency` fails if the two drift.

### What it ages matches by

`createdAt`, which the client writes as a `serverTimestamp()` and
`firestore.rules` pins to `request.time`. That pin is the point: an age taken
from a client clock could be wrong in the direction that deletes a match
somebody is still playing, and a client that writes the far future would get a
match that never expires. The rules also stop either participant moving it
afterwards.

**This means the rules must be deployed before the cleanup does anything
useful**, and after they are, a match cannot be created without it:

```bash
firebase deploy --only firestore:rules
```

### The one-off legacy sweep

Matches created before `createdAt` existed have no timestamp, so the recurring
job leaves them alone — it never guesses at a live match's age. Clear the
backlog once, by hand, from Cloud Shell:

```bash
cd ~/wordcade && git pull origin main
npm install --no-save firebase-admin
node tools/cleanup-matches.mjs --legacy --dry-run   # look first
node tools/cleanup-matches.mjs --legacy
```

`--legacy` deletes timestampless docs that are `finished` or still `waiting`,
and `playing` ones whose deadline is more than the retention window past. A
`playing` doc with no deadline at all is left alone rather than guessed at, so a
handful may survive the sweep; they will be the last of them, since every match
created from now on carries a `createdAt`.

### Cost

One `matches` read per document per day, and one delete per expired match.
Deletes go out in batches of 500, which is Firestore's cap on a write batch.


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
