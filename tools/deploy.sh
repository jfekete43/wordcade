#!/usr/bin/env bash
#
# The whole deploy, as one command.
#
#   bash tools/deploy.sh            pull, deploy, then offer each data step
#   bash tools/deploy.sh --yes      no prompts (for when you are at a desk)
#   bash tools/deploy.sh --deploy   deploy only, skip the data steps
#
# This exists because the sequence is five lines, the order matters, and
# Cloud Shell in a phone browser will not let you paste — so the alternative is
# typing it, which is how you get a half-finished deploy. It also encodes the
# bits that are easy to get wrong: indexes before functions (they build in the
# background and a query fails until its index is green), and a dry run in
# front of anything that deletes.
#
# Stops at the first failure. Nothing here is destructive without asking.
set -euo pipefail

PROJECT="wordcade-387e8"
cd "$(dirname "$0")/.."

YES=0; DEPLOY_ONLY=0
for a in "$@"; do
  case "$a" in
    --yes|-y) YES=1 ;;
    --deploy) DEPLOY_ONLY=1 ;;
    *) echo "unknown argument: $a"; echo "usage: deploy.sh [--yes] [--deploy]"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
ask() {  # ask "question" -> 0 if yes
  [ "$YES" = "1" ] && return 0
  # Reading from /dev/tty looks more robust but is the opposite: it fails
  # outright wherever there is no controlling terminal, and under `set -u` the
  # unset reply then takes the whole script down mid-deploy. Plain stdin, and
  # no terminal means "no" rather than a crash.
  if [ ! -t 0 ]; then
    echo "  (not a terminal — skipping; use --yes to apply unattended)"
    return 1
  fi
  local reply=""
  printf '\n\033[1;33m%s\033[0m [y/N] ' "$1"
  read -r -n 1 reply || true
  echo
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

say "Pulling latest"
git pull --ff-only origin main
echo "now at: $(git log --oneline -1)"

say "Deploying indexes, rules and functions"
# Indexes first on purpose: they build asynchronously, and a query whose index
# is still building fails with FAILED_PRECONDITION until it goes green.
# Functions take a few minutes and are the part most likely to need a retry —
# re-running this script is safe, anything already current is skipped.
#
# Rules belong here too, and were missing: the script deployed indexes and
# functions only, so a release whose client change needed a rules change got
# half of itself. That is worse than it sounds, because index.html ships on
# GitHub Pages the moment it is pushed — it does not wait for a deploy. Any
# gap between what the live page writes and what the deployed rules allow is
# a window where the write is simply denied in production.
firebase deploy --only firestore:indexes,firestore:rules,functions --project "$PROJECT"

if [ "$DEPLOY_ONLY" = "1" ]; then
  say "Done (--deploy: skipped the data steps)"
  exit 0
fi

# The Admin SDK is not a repo dependency; --no-save keeps it out of the tree.
if [ ! -d node_modules/firebase-admin ]; then
  say "Installing firebase-admin"
  npm install --no-save firebase-admin
fi

say "Weekly leaderboard backfill — dry run"
node tools/backfill-period-best.mjs --dry-run
if ask "Apply the backfill?"; then
  node tools/backfill-period-best.mjs
else
  echo "skipped — the board fills in on its own as people play"
fi

say "Old match cleanup — dry run"
# --legacy covers documents created before matches carried a createdAt. The
# daily job never passes it, so this stays a hand-run sweep.
node tools/cleanup-matches.mjs --legacy --dry-run
if ask "Delete those matches?"; then
  node tools/cleanup-matches.mjs --legacy
else
  echo "skipped"
fi

say "All done"
