#!/usr/bin/env bash
# gate:decisions
#
# WHAT THIS GATE DECIDES, and nothing else:
#
#   1. AN OWNER DECISION IS FINAL. A decision record under
#      delivery/decisions/ whose status is `decided` may not have its
#      question or its decision changed. The pair is checksummed into
#      delivery/decisions/decided.lock. A record may only change by being
#      SUPERSEDED: a newer record naming it in `supersedes:`. Editing the
#      lock without a superseding record fails here, loudly, by name.
#
#   2. A PLAN ITERATION GETS AT MOST TWO ADVERSARIAL REVIEW ROUNDS. Review
#      documents under delivery/review/ are grouped by their iteration stem
#      and the rounds counted. A third round fails. What round two leaves
#      open goes into the implementer's brief as work.
#
# WHAT IT DOES NOT DECIDE. It cannot see a decision being relitigated in
# prose, a reviewer restating a settled consequence as if it were news, or
# an orchestrator asking the owner a question they have already answered in
# conversation. Those are judgement, and the charter carries them. This gate
# closes the two holes a script can actually close: a decided record quietly
# changing, and the review treadmill running past its cap.
set -uo pipefail
cd "$(dirname "$0")/.."

decisions_dir="delivery/decisions"
lock="$decisions_dir/decided.lock"
status=0

if [ ! -d "$decisions_dir" ]; then
  echo "gate:decisions: $decisions_dir does not exist" >&2
  exit 1
fi

# The fingerprint of a decided record: its id, its question and its decision,
# with whitespace collapsed so a re-wrap is not a change.
fingerprint() {
  awk '
    /^(question|decided):/ { capture = 1; printf "\n%s", $0; next }
    /^[a-z-]+:/            { capture = 0 }
    capture                { printf " %s", $0 }
  ' "$1" | tr -s ' \t\n' ' ' | sed 's/^ //; s/ $//'
}

decided_records() {
  grep -l '^status: decided' "$decisions_dir"/DR-*.yaml 2>/dev/null | sort
}

superseded_ids() {
  grep -h '^supersedes:' "$decisions_dir"/DR-*.yaml 2>/dev/null |
    sed 's/^supersedes:[[:space:]]*//' | tr -d '"' | tr ',' '\n' |
    sed 's/[[:space:]]//g' | grep -v '^$' | sort -u
}

if [ "${1:-}" = "--write-lock" ]; then
  : > "$lock"
  while read -r file; do
    [ -n "$file" ] || continue
    id=$(basename "$file" .yaml)
    printf '%s  %s\n' "$id" "$(fingerprint "$file" | shasum -a 256 | cut -d' ' -f1)" >> "$lock"
  done < <(decided_records)
  echo "gate:decisions: wrote $lock with $(wc -l < "$lock" | tr -d ' ') decided records"
  exit 0
fi

if [ ! -f "$lock" ]; then
  echo "gate:decisions: $lock is missing. Run: npm run gate:decisions -- --write-lock" >&2
  exit 1
fi

supersedes=$(superseded_ids)

# Rule 1: no decided record changes its question or its decision.
while read -r id recorded; do
  [ -n "$id" ] || continue
  file="$decisions_dir/$id.yaml"
  if [ ! -f "$file" ]; then
    echo "gate:decisions: $id is in the lock and its record is gone. An owner decision is not deleted, it is superseded." >&2
    status=1
    continue
  fi
  current=$(fingerprint "$file" | shasum -a 256 | cut -d' ' -f1)
  if [ "$current" != "$recorded" ]; then
    if echo "$supersedes" | grep -qx "$id"; then
      continue
    fi
    echo "gate:decisions: $id changed its question or its decision and nothing supersedes it." >&2
    echo "  An owner decision is reversed only by the owner, in a NEW record naming this one in supersedes:." >&2
    echo "  If the owner did reverse it, add that record and re-run with --write-lock." >&2
    status=1
  fi
done < "$lock"

# Every decided record must be in the lock, so a new one cannot skip rule 1.
while read -r file; do
  [ -n "$file" ] || continue
  id=$(basename "$file" .yaml)
  if ! cut -d' ' -f1 "$lock" | grep -qx "$id"; then
    echo "gate:decisions: $id is decided and is not in the lock. Run: npm run gate:decisions -- --write-lock" >&2
    status=1
  fi
done < <(decided_records)

# Rule 2: at most two review rounds per lane, plan review and clean-room
# review alike. A lane is a review stem with its round suffix removed, so the
# criteria lane and the hazard lane are counted separately, which is what dual
# review requires, and a third round on either one fails.
#
# A verdict may be YAML (every review written before kernel 0.2.1) or JSON
# (the clean-room reviewer role writes delivery/review/<phase>-<lane>.json
# from 0.2.1 on). Both extensions are stripped before the lane is taken, so
# a JSON round counts against the same cap as a YAML one; stripping only
# .yaml let every JSON round form a lane of its own and pass unseen.
review_dir="delivery/review"
lane_of() {
  sed -E 's/\.(yaml|json)$//; s/-round[0-9]*$//'
}
if [ -d "$review_dir" ]; then
  while read -r stem; do
    [ -n "$stem" ] || continue
    total=$(ls "$review_dir" 2>/dev/null | lane_of | grep -cxF -- "$stem")
    if [ "$total" -gt 2 ]; then
      echo "gate:decisions: review lane '$stem' carries $total rounds, the cap is 2." >&2
      echo "  What round two leaves open is carried into the implementer's brief as work, not into a third round." >&2
      status=1
    fi
  done < <(ls "$review_dir" 2>/dev/null | lane_of | sort -u)
fi

if [ "$status" -eq 0 ]; then
  echo "gate:decisions clean"
fi
exit "$status"
