#!/usr/bin/env bash
# gate:privacy
#
# Real statement content must never reach the repository. This gate makes
# that mechanical instead of something reviewers are asked to notice, after
# a real amount from a real statement reached three pushed commits in M3-P3.
#
# Two rules, both of which a regex can decide:
#
#   1. Commit messages carry no amount and no data row. A commit message
#      describes the change. It never carries a sample of the data, not even
#      an invented one, because nobody reviewing a message can tell which it
#      is. This is the owner's rule of 2026-08-22.
#
#   2. Every account or card number shape in the tree is on the allow list at
#      test/fixtures/allowed-identifiers.txt. Fixtures need identifiers and
#      theirs are invented, so the check is not "is there one" but "is this
#      one known". A new one fails until a human puts it on the list, which is
#      the moment someone looks at where it came from.
#
# Exit 0 clean, 1 with the offending location and reason.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

ALLOW=test/fixtures/allowed-identifiers.txt
fail=0
report() { printf '%s\n' "$1" >&2; fail=1; }

AMOUNT='([0-9]{1,3}(\.[0-9]{3})+,[0-9]{2}|[0-9]+,[0-9]{2})'
CURRENCY='(EUR|€)[[:space:]]*[0-9]'
IBAN='\b[A-Z]{2}[0-9]{2}([[:space:]]?[0-9]{4}){3}\b'
PAN='\b([0-9]{4}[[:space:]-]){3}[0-9]{4}\b'

# --- 1. commit messages on this branch -------------------------------------
base="$(git merge-base HEAD origin/main 2>/dev/null || true)"
if [ -n "$base" ]; then
  for sha in $(git rev-list "$base"..HEAD); do
    msg="$(git log -1 --format=%B "$sha")"
    for pat in "$AMOUNT" "$CURRENCY" "$IBAN" "$PAN"; do
      hit="$(printf '%s' "$msg" | grep -Eo "$pat" | head -1 || true)"
      [ -n "$hit" ] && report "commit ${sha:0:8}: message carries an amount or a data row (\"$hit\"). A commit message describes the change, never a sample of the data."
    done
  done
fi

# --- 2. identifier shapes must be on the allow list ------------------------
if [ ! -f "$ALLOW" ]; then
  report "missing $ALLOW: the allow list of invented identifiers is required."
else
  known="$(grep -vE '^[[:space:]]*(#|$)' "$ALLOW" | tr -d ' ' | sort -u)"
  for f in $(git ls-files); do
    [ -f "$f" ] || continue
    case "$f" in \
      package-lock.json|*.png|*.jpg|*.jpeg|*.pdf|*.ico|*.woff|*.woff2|"$ALLOW") continue;; \
    esac
    for hit in $(grep -Eoh "$IBAN|$PAN" "$f" 2>/dev/null | tr -d ' ' | sort -u); do
      printf '%s\n' "$known" | grep -qxF "$hit" || \
        report "$f: identifier shape not on the allow list. Add it to $ALLOW with a note on where it came from, or replace it with an invented value. Never add a value taken from a real statement."
    done
  done
fi

[ "$fail" -eq 0 ] && echo "gate:privacy clean"
exit "$fail"
