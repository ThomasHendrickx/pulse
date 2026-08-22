#!/usr/bin/env bash
# gate:privacy
#
# WHAT THIS GATE DECIDES, exactly, and nothing more. Two clean-room reviews
# independently found that its first version claimed to make "real statement
# content never reaches the repository" mechanical, and did not. Read this
# list before trusting it.
#
#   1. Commit messages on this branch carry no amount and no data row. This
#      is the owner's rule of 2026-08-22, and it is the one rule here that is
#      complete: a message needs no data, ever, so the check can be absolute.
#
#   2. Every account, card or masked-card shape in the tree is on the allow
#      list at test/fixtures/allowed-identifiers.txt. Fixtures need
#      identifiers and theirs are invented, so the check is not "is there
#      one" but "is this one known". A new one fails until a person writes
#      down where it came from.
#
#   3. No tracked PDF carries a compressed stream. A real bank PDF does, and
#      compression is also why rule 2 cannot see inside one. The fixture
#      builder emits uncompressed PDFs.
#
# WHAT IT DOES NOT DECIDE, and what still needs a human:
#
#   A merchant name, a place name, a person's name, a date or an amount
#   sitting inside a tracked FILE is invisible to every rule above. That is
#   not a bug to be regexed away: those strings look exactly like invented
#   ones, which is the whole difficulty. Two real merchant descriptors
#   reached this public repository that way and both reviews found them by
#   probing the tree against the real documents, not by running this gate.
#   Until something does that automatically, this gate narrows the hole; it
#   does not close it.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

ALLOW=test/fixtures/allowed-identifiers.txt
fail=0
report() { printf '%s\n' "$1" >&2; fail=1; }

AMOUNT='([0-9]{1,3}(\.[0-9]{3})+,[0-9]{2}|[0-9]+,[0-9]{2})'
CURRENCY='(EUR|€)[[:space:]]*[0-9]'
# Account shapes, TWO patterns since fix round 4 (finding HZ3-M3P3-03),
# because one pattern could not cover both gaps without swallowing every
# base64 asset hash in the tree, measured rather than guessed.
#
# IBAN_LOCAL is the Belgian-length, digits-body shape the gate has always
# had, with the country letters now matched in either case: a lower-case
# account shape used to pass unlisted while the card half of this same
# script folded case, so the two halves disagreed with each other and with
# the allow list's promise.
#
# IBAN_FOREIGN accepts LETTERS IN THE BODY and any real IBAN length. An
# account number whose body carries letters never matched the old pattern
# at all, and one has been sitting in two tracked fixtures unlisted with
# this gate exiting 0. It is deliberately UPPER-CASE ONLY: an IBAN is
# written in capitals by convention, while the mixed-case runs this
# widening otherwise catches are asset hashes and base64 fragments, four of
# which this tree carries and none of which anyone can write a provenance
# note for. It also takes the COMPACT form only: allowing a separator
# inside a variable-length body let the match run past the account number
# into the following upper-case word, which invented four shapes nobody
# could list. The spaced form is what IBAN_LOCAL is for.
IBAN_LOCAL='\b[A-Za-z]{2}[0-9]{2}([[:space:]]?[0-9]{4}){3}\b'
IBAN_FOREIGN='\b[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}\b'
IBAN="$IBAN_LOCAL|$IBAN_FOREIGN"
PAN='\b([0-9]{4}[[:space:]-]){3}[0-9]{4}\b'
# Masked PAN: the only form a card statement prints, and invisible to a
# digits-only pattern. Any mix of digits and mask glyphs in card grouping.
MASKED='\b[0-9Xx*]{4}[[:space:]-]?[0-9Xx*]{4}[[:space:]-]?[0-9Xx*]{4}[[:space:]-]?[0-9Xx*]{4}\b'

# --- 1. commit messages on this branch -------------------------------------
base="$(git merge-base HEAD origin/main 2>/dev/null || true)"
if [ -n "$base" ]; then
  for sha in $(git rev-list "$base"..HEAD); do
    msg="$(git log -1 --format=%B "$sha")"
    for pat in "$AMOUNT" "$CURRENCY" "$IBAN" "$PAN" "$MASKED"; do
      hit="$(printf '%s' "$msg" | grep -Eo "$pat" | head -1 || true)"
      case "$pat" in "$MASKED") printf '%s' "$hit" | grep -qE '[Xx*]' || hit="";; esac
      [ -n "$hit" ] && report "commit ${sha:0:8}: message carries an amount or a data row (\"$hit\"). A commit message describes the change, never a sample of the data."
    done
  done
fi

# --- 2. identifier shapes must be on the allow list ------------------------
if [ ! -f "$ALLOW" ]; then
  report "missing $ALLOW: the allow list of invented identifiers is required."
else
  # NORMALISE BOTH SIDES THE WAY THE ALLOW LIST ALREADY PROMISES. Its
  # header says spaces and dashes are ignored when matching, and until fix
  # round 3 this only stripped spaces, so a listed card written with
  # hyphens failed the gate and a lower-case mask glyph failed it too. A
  # card number's identity is its digits and its mask POSITIONS, never its
  # typography, which is the same rule the KBC template now applies when
  # it decides whether two statements belong to one card. Case is folded
  # so a mask written x or X or * is one value.
  norm() { tr -d ' -' | tr 'x*' 'XX' | tr 'a-z' 'A-Z'; }
  known="$(grep -vE '^[[:space:]]*(#|$)' "$ALLOW" | norm | sort -u)"
  for f in $(git ls-files); do
    [ -f "$f" ] || continue
    case "$f" in \
      package-lock.json|*.png|*.jpg|*.jpeg|*.ico|*.woff|*.woff2|"$ALLOW") continue;; \
    esac
    # MASKED matches are only taken when they actually carry a mask glyph,
    # otherwise the shape swallows UUID fragments and plain digit runs that
    # $PAN already covers.
    for hit in $( { grep -Eoh "$IBAN|$PAN" "$f" 2>/dev/null; \
                    grep -Eoh "$MASKED" "$f" 2>/dev/null | grep -E '[Xx*]'; \
                  } | norm | sort -u); do
      printf '%s\n' "$known" | grep -qxF "$hit" || \
        report "$f: identifier shape not on the allow list. Add it to $ALLOW with a note on where it came from, or replace it with an invented value. Never add a value taken from a real statement."
    done
  done
fi

# --- 3. no compressed PDF is ever committed -------------------------------
# A real bank statement PDF carries compressed content streams, which is also
# why rule 2 cannot see inside one: grep reads no text at all. The fixture
# PDFs are emitted uncompressed by test/fixtures/generate-pdf-fixtures.ts, so
# "carries a compressed stream" is a clean stand-in for "came from a bank".
for f in $(git ls-files '*.pdf'); do
  [ -f "$f" ] || continue
  if grep -aq 'FlateDecode' "$f" 2>/dev/null; then
    report "$f: PDF carries a compressed stream, so it did not come from the fixture builder and no identifier check can read inside it. Real statements are never committed. Generate fixtures with test/fixtures/generate-pdf-fixtures.ts."
  fi
done

[ "$fail" -eq 0 ] && echo "gate:privacy clean"
exit "$fail"
