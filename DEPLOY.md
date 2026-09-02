# Deploying the Cloud Functions + Firestore rules

This covers `functions/` and `firestore.rules` — the server-side pieces that
validate score/wallet/mmr instead of trusting the client. The static site
(`index.html`) is unaffected by any of this and keeps deploying however it
already does (e.g. GitHub Pages via `CNAME`).

## 1. Enable the Blaze plan

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

## 2. Install the Firebase CLI and authenticate

```bash
npm install -g firebase-tools
firebase login
```

## 3. Install function dependencies

```bash
cd functions
npm install
cd ..
```

## 4. Deploy

```bash
firebase deploy --only functions,firestore:rules --project wordcade-387e8
```

All 6 functions should deploy successfully: `onRunCreated`,
`onMatchFinished`, `claimChallenge`, `purchaseItem`, `changeUsername`,
`refreshProfile`.

Note: this repo's `firebase.json` intentionally has no `hosting` section
(the site is served via GitHub Pages, not Firebase Hosting) — running
`firebase deploy` without `--only` would try to deploy hosting too and is
not what you want here.

## 5. Verify

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
