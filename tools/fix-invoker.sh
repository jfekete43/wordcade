#!/usr/bin/env bash
#
# Grant public invoke on every callable Cloud Function.
#
#   bash tools/fix-invoker.sh              every callable
#   bash tools/fix-invoker.sh guessSprintWord startMarathon
#
# WHY THIS EXISTS
#
# A Firebase callable is a Cloud Run service behind an HTTPS endpoint. The
# browser reaches it only if allUsers holds roles/run.invoker on that service.
# `firebase deploy` normally grants it as the last step of creating a new
# function - and that step can fail on its own, while the deploy of the code
# itself succeeds. The deploy says so, in a block that is easy to read past:
#
#   Unable to set the invoker for the IAM policy on the following functions:
#       guessSprintWord(us-central1)
#
# What the player gets from a function in that state is a browser alert
# reading, in full, "internal". The request is refused at the edge with a 403
# before it ever reaches the code, so the Firebase client SDK has no
# HttpsError to unwrap and falls back to printing the bare code. Nothing is
# logged in Cloud Logging, because nothing ever ran. readableFailures cannot
# help: it wraps the handler, and the handler is not what failed.
#
# Re-running the deploy does NOT fix it. The code is unchanged by then, so
# the function is skipped as already current - and the invoker step is skipped
# along with it. Hence this: the one step, on its own, idempotently.
#
# Safe to re-run. Granting a role that is already held is a no-op.
set -euo pipefail

PROJECT="wordcade-387e8"
REGION="us-central1"
cd "$(dirname "$0")/.."

# The callables, read out of the source rather than listed here, so a new one
# is covered the day it is written.
if [ "$#" -gt 0 ]; then
  FNS=("$@")
else
  mapfile -t FNS < <(grep -oE '^exports\.[A-Za-z0-9_]+ = onCall' functions/index.js \
    | sed 's/^exports\.//; s/ = onCall$//')
fi

if [ "${#FNS[@]}" -eq 0 ]; then
  echo "no callables found in functions/index.js"; exit 1
fi

echo "Granting public invoke on ${#FNS[@]} callable(s) in $PROJECT/$REGION:"
printf '  %s\n' "${FNS[@]}"
echo

failed=0
for fn in "${FNS[@]}"; do
  # Cloud Run lowercases the service name; the function name does not change.
  svc="$(printf '%s' "$fn" | tr '[:upper:]' '[:lower:]')"
  printf '%-28s ' "$fn"
  if gcloud run services add-iam-policy-binding "$svc" \
       --region="$REGION" --project="$PROJECT" \
       --member=allUsers --role=roles/run.invoker >/dev/null 2>&1; then
    echo "ok"
  else
    echo "FAILED"
    failed=$((failed + 1))
  fi
done

echo
if [ "$failed" -gt 0 ]; then
  echo "$failed failed. Re-run with one name to see the real error:"
  echo "  gcloud run services add-iam-policy-binding <lowercased-name> \\"
  echo "    --region=$REGION --project=$PROJECT --member=allUsers --role=roles/run.invoker"
  exit 1
fi
echo "All set. A callable that was answering \"internal\" should now respond."
