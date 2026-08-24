#!/usr/bin/env bash
# gate:work-history
#
# EVERY WORK HISTORY UNDER delivery/work-history/ MUST PARSE AS YAML.
#
# WHY THIS EXISTS. Two acceptance criteria of M3-P14 and M3-P15 are satisfied
# BY a work history: 14.10 and 15.8 both require the captured output of the
# verification-first step to live in it, one block per claim and per baseline.
# The phase shipped a work history that no tool in this project could parse,
# and no gate noticed, because none of them reads it. It blocked the kernel's
# own validator and it blocked a reviewer's verdict validation.
#
# It was ONE unquoted scalar containing ": " when the reviewer found it, and
# when that one was fixed the parser reached a SECOND error the reviewer had
# never seen, because parsing stops at the first. That is the argument for a
# gate rather than for care: a document that fails to parse hides how many
# ways it fails to parse.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0
shopt -s nullglob
for f in delivery/work-history/*.yaml delivery/review/*.yaml; do
  [ -f "$f" ] || continue
  if ! python3 -c "import sys,yaml; yaml.safe_load(open(sys.argv[1]))" "$f" 2>/tmp/gate-wh-err; then
    printf '%s: not valid YAML\n' "$f" >&2
    sed 's/^/    /' /tmp/gate-wh-err >&2
    fail=1
  fi
done
rm -f /tmp/gate-wh-err
[ "$fail" -eq 0 ] && echo "gate:work-history clean (every delivery yaml parses)"
exit "$fail"
