# Anti-cheat: what is built, and what is planned

Written 25 November 2026, after a third incident in a short span by two
different people. Nothing in the "planned" half is built. This exists so that
when the go-ahead comes, there is no argument about what we agreed.

## The threat model

The server already closes the worst class of attack. `guessSprintWord` grades
every guess server-side and only returns `answer` once the attempt is
finished, so nobody is reading the word out of the page. The client never
holds it.

That leaves one way to "already know" the word: **having played it before.**
One account gets one attempt per day (`sprintAttempts/{uid}/days/{date}`), so
a second play needs a second identity — and guest accounts are free and
unlimited. That is the whole lever.

### What actually happens today

Worked through against the code, because the intuition is wrong in a way
that matters:

1. Account B plays. `runs/sprint_B_<date>` = 50. B's attempt is now finished.
2. Signs out. A **brand new anonymous uid A** is minted.
3. Plays again as A, now knowing the word. `runs/sprint_A_<date>` = 500.
4. Signs back in. `linkWithPopup` throws `credential-already-in-use` (B
   already owns that Google credential), so the code falls through to
   `signInWithCredential` — a **switch**, not a merge.

**Both run documents survive.** The 500 sits on the board under the guest's
handle and the 50 under the real one, as two unrelated players. Nothing
overrides anything, because as far as the game is concerned they are two
people. That is the shape of every incident so far: a guest-style handle at
the top of the board.

Note what is *already* safe: a guest who plays and then **links** keeps the
same uid, the same attempt document, and cannot replay. That path was closed
deliberately and the comment in `index.html` says so. The hole is the switch.

## Built, as of this document

**The admin page** (`admin.html` + the `admin*` callables). Look up a handle,
read a day's board, open one attempt guess by guess, void or correct a run,
optionally reclaim the payout. Gated on `requireAdmin` — the caller's
verified email against the `ADMIN_EMAIL` secret.

The point of it is response time. A cheated run sat at the top of the board
for most of a day because the only way to remove it was a laptop, Cloud
Shell, and working application-default credentials. Now it is a phone and a
browser.

**A flag that records.** `adminFlagUser` writes `flagged` on the user
document. **Nothing reads it.** A flagged player's runs score exactly as
before. Making it bite is step 3 below.

## Planned, in order

### 1. Accounts-only leaderboard, with guests on a different word

Two halves, and they only work together.

**Accounts only on the board.** Guests play and see their result and where
they would have placed; only accounts appear. `GAUNTLET_REQUIRES_ACCOUNT`
already exists as exactly this pattern — mirrored in `index.html` and
`functions/index.js`, with `requireNonGuest(request)` wired at the callable —
so a `SPRINT_REQUIRES_ACCOUNT` flag follows a path that is already proven.

On its own this is not enough. A cheater can still play as a guest for free,
learn the word, and then play it on an account. The guest run costs them
nothing.

**So guests get a different word.** Two draws per day: the board word for
accounts, a separate word for guests. A guest run then teaches you the
*guest* word, which is not the one the board is playing. The reconnaissance
run becomes worthless, and that is the vector every incident so far has
used.

What this does NOT close: two real accounts. Account 1 plays and learns the
word, account 2 plays it knowing. That is what step 2 is for.

Three things to get right:

- **The honest guest who signs up mid-day.** They played the guest word, so
  their attempt document for today exists. They must still be allowed one
  attempt on the board word, and that is *safe* precisely because the words
  differ — they have not seen it. Without this, signing up costs you the day.
- **Sharing.** A guest's share grid is for a different word. Two people
  comparing grids would see patterns that cannot both be right. The guest
  share needs to say which it is, or not offer one.
- **The wording.** The homepage blurb and the fair-play card both say "the
  same word for everyone". That stops being true for guests. It becomes
  "the same word for everyone on the board", and both copies have to change
  with the feature, not after it.

### 2. An eligibility threshold

An account appears on the board only once it is a few days old, or has
played a few previous days. A throwaway cannot rank on the day it is made,
so cheating has to be planned days ahead rather than improvised.

Honest new players see "you join the leaderboard in 2 days", which is a small
cost and arguably a reason to come back.

This is the step that answers "what if it continues even with accounts only".

### 3. Make the flag bite

`onRunCreated` reads `flagged` and scores the run zero. A few lines, and it
turns a repeat offender from a daily chore into nothing at all.

Worth doing only after step 2, because until then a flagged player just makes
another account.

### 4. Held in reserve: guests cannot play Sprint

The only change that removes the free reconnaissance run outright, and the
only one with real player cost. Not to be reached for before the three above
have been tried.

## Rejected, with the reason

**Per-player words for everyone.** It dissolves the premise. `functions/word-difficulty.json`
shows difficulty varies enormously across the list, so a board where everyone
had their own word would stop comparing players and start comparing words —
trading a cheating problem that affects a handful of people for an
unfairness problem that is permanent, invisible, and affects all of them.

**Recording time-to-first-guess.** Considered and dropped. The signal is
weaker than it looks: plenty of honest players have a fixed opener and type
it instantly.
