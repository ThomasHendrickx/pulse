# M3-P10 running notes (beacon)

Branch: claude/m3-p10-busy-state, worktree /home/user/wt-m3p10, base 8d99dfd.

## Opening survey (before any edit)

Head is 8d99dfd, which carries M3-P14 (the accounts screen). The plan section
for M3-P10 was written against 89ed187, before M3-P14 merged, so three counts
in it are stale at this head. Recorded here as they are found.

## Criterion 10.11 red witness (captured)

Widened glob committed. With a bare JSX text node temporarily added to
src/platform/ui/submit-button.tsx:

    $ npm run lint
    /home/user/wt-m3p10/src/platform/ui/submit-button.tsx
      89:17  error  Missing JSX expression container around literal string: "RED WITNESS"  react/jsx-no-literals
    1 problem (1 error, 0 warnings)
    exit 1

With the temporary edit reverted (not committed, `git diff --stat` on that
path prints nothing): `npm run lint` exit 0.

