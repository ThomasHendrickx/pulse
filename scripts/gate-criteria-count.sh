#!/usr/bin/env bash
# THE ACCOUNTING GATE, and it exists because the count was wrong rather than
# the artifact (finding CR-P14C2-05). A clean-room lane found five criteria
# counted MET on evidence the SAME DOCUMENT contradicted: three carried their
# own `partial:` block while being counted met, and two were gate criteria
# called green while the gate they name exits 1.
#
# A work history that contradicts itself inside one file is worse than one
# that under-claims, because a reader who spots it stops trusting the rest.
# So the rule is mechanical from here: an entry that carries a partial field
# is not met, and the standing count must equal what the entries say.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
python3 - "$@" <<'PY'
import sys, glob, yaml

fail = 0
for path in sorted(glob.glob("delivery/work-history/*.yaml")):
    with open(path) as handle:
        doc = yaml.safe_load(handle)
    walk = (doc or {}).get("acceptance-walk")
    if not isinstance(walk, dict):
        continue
    entries = []
    for key, value in walk.items():
        if isinstance(value, list):
            entries.extend(e for e in value if isinstance(e, dict) and "id" in e)
    if not entries:
        continue

    # RULE ONE: a verdict of met may not sit beside a partial field.
    for entry in entries:
        verdict = str(entry.get("verdict", "")).strip().lower()
        has_partial = any(
            k == "partial" or k.startswith("partial-") for k in entry
        )
        if verdict.startswith("met") and has_partial:
            print(
                f"{path}: criterion {entry['id']} is counted met and carries a "
                f"partial field. One of the two is wrong.",
                file=sys.stderr,
            )
            fail = 1

    # RULE TWO: the standing count must equal what the entries say.
    standing = (doc or {}).get("fix-round-criteria-standing")
    if isinstance(standing, dict) and "met-ids" in standing:
        declared = sorted(str(x) for x in standing["met-ids"])
        actual = sorted(
            str(e["id"])
            for e in entries
            if str(e.get("verdict", "")).strip().lower().startswith("met")
        )
        if declared != actual:
            only_declared = [x for x in declared if x not in actual]
            only_actual = [x for x in actual if x not in declared]
            print(
                f"{path}: the standing block's met list disagrees with the "
                f"entries. Declared but not met in the walk: {only_declared}. "
                f"Met in the walk but not declared: {only_actual}.",
                file=sys.stderr,
            )
            fail = 1

if fail == 0:
    print("gate:criteria-count clean (no met verdict carries a partial, and every standing count matches its entries)")
sys.exit(fail)
PY
