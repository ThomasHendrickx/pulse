#!/usr/bin/env bash
# Advance every remote branch onto current main, and report any branch still
# carrying a given string.
#
# Why this exists. Removing something from a file at HEAD does not remove it
# from the other branches that were cut before the fix, and on a public
# repository each of those branches keeps publishing it. That happened three
# times in one day with the same string: fixed on main, still live on five
# branches; fixed again, still live on eight. Checking the branch you are
# standing on is not checking the repository.
#
#   scripts/sync-branches.sh            advance every branch onto main
#   scripts/sync-branches.sh <string>   advance, then report branches still
#                                       carrying <string>, case-insensitive
#
# A branch already contained in main is force-reset to main. A branch with
# its own commits gets main merged into it. Nothing is discarded either way.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
needle="${1:-}"

git fetch -q origin '+refs/heads/*:refs/remotes/origin/*'
main="$(git rev-parse origin/main)"
tmp="$(mktemp -d)/wt"

for b in $(git ls-remote --heads origin | sed 's|.*refs/heads/||'); do
  [ "$b" = "main" ] && continue
  git merge-base --is-ancestor "origin/$b" "$main" 2>/dev/null && {
    [ "$(git rev-parse "origin/$b")" = "$main" ] && continue
    echo "reset  $b"
    git push -q --force origin "$main:refs/heads/$b" || echo "  push failed: $b"
    continue
  }
  git merge-base --is-ancestor "$main" "origin/$b" 2>/dev/null && continue
  echo "merge  $b"
  git worktree add -q --detach "$tmp" "origin/$b" || { echo "  worktree failed: $b"; continue; }
  if git -C "$tmp" merge -q --no-edit origin/main; then
    git push -q origin "$(git -C "$tmp" rev-parse HEAD):refs/heads/$b" || echo "  push failed: $b"
  else
    echo "  CONFLICT, left alone: $b"
  fi
  git worktree remove --force "$tmp"
done

[ -z "$needle" ] && exit 0

git fetch -q origin '+refs/heads/*:refs/remotes/origin/*'
found=0
for b in $(git ls-remote --heads origin | sed 's|.*refs/heads/||'); do
  git grep -q -i -- "$needle" "origin/$b" -- . 2>/dev/null && { echo "STILL PRESENT: $b"; found=1; }
done
[ "$found" -eq 0 ] && echo "clean: no branch carries it"
exit "$found"
