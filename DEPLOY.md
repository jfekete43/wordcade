# Deploying the Cloud Functions + Firestore rules

This covers `functions/` and `firestore.rules` — the server-side pieces that
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
firebase deploy --only functions,firestore:rules --project wordcade-387e8
```

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
firebase deploy --only firestore:rules --project wordcade-387e8   # security rules only
firebase deploy --only functions --project wordcade-387e8         # cloud functions only
```

Rules deploy in seconds; functions take a few minutes.

### When a deploy is actually needed

| Changed file | Needs a deploy? |
| --- | --- |
| `index.html`, `words.js`, `privacy.html`, `terms.html` | **No** — GitHub Pages serves these straight from `main`, live within a minute of the push |
| `functions/index.js` | **Yes** — `--only functions` |
| `firestore.rules` | **Yes** — `--only firestore:rules` |

### If it errors

- `Cloud Functions V2 regions are currently unreachable: us-central1` — a
  transient Google-side blip, nothing to do with the code. Run it again.
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
firebase deploy --only functions,firestore:rules --project wordcade-387e8
```

All 19 functions should deploy successfully: `onRunCreated`,
`onMatchFinished`, `finishClashMatch`, `forfeitClashMatch`, `claimChallenge`,
`purchaseItem`, `changeUsername`, `refreshProfile`, `generateDailyPuzzle`,
`startDailyGauntlet`, `guessDailyWord`, `startSuddenDeath`,
`guessSuddenDeathWord`, `resolveSuddenDeathTimeout`, `joinFfaMatch`,
`leaveFfaMatch`, `startFfaMatch`, `finishFfaMatch`, `onFfaMatchFinished`.

(If you are reading an older copy of this file that says 6, that was written
before Clash sudden-death, the Daily Gauntlet and FFA existed.)

Note: this repo's `firebase.json` intentionally has no `hosting` section
(the site is served via GitHub Pages, not Firebase Hosting) — running
`firebase deploy` without `--only` would try to deploy hosting too and is
not what you want here.

## Verifying a deploy

- Play a round, cash out, buy a shop item, claim a challenge, change your
  handle — all should work exactly as before from the player's side.
- Firebase Console → **Functions** → a function → **Logs** should show
  invocations as you do those actions.
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
