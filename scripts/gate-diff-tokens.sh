#!/usr/bin/env bash
# CRITERION 14.10'S OWN GREP, and it is the WHOLE guard on this phase's new
# surface. `npm run gate:tokens` greps src/modules/*/ui only: it never looks
# under src/app/, where this phase's accounts route lives, and it matches
# neither a spacing literal nor a colour written as rgb(), hsl() or a named
# colour. Reporting that gate green and moving on would leave the new screen
# unguarded, so this runs beside it and its output goes in the work history.
#
# SCOPED TO THE DIFF, NOT TO WHOLE FILES, and the reason is written down
# rather than left to look like laziness: src/app/globals.css is in this
# phase's files-to-touch and already carries px lengths in rules and in
# comments this phase does not write, so a whole-file form of this check
# would be red before the phase started and would be disabled rather than
# met.
#
# TWO EXCEPTIONS, named rather than silently skipped:
#   1. a token DEFINITION in styles/tokens.css, which is where a literal
#      belongs and the only place it may appear;
#   2. a value written inside a CSS comment.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
base="$(git merge-base HEAD origin/main)"
# DIFFED AGAINST THE WORKING TREE, not against HEAD. A form written
# "$base..HEAD" reads only what is already committed, so it reports clean on
# exactly the change you are about to commit, which is the moment this check
# is for. Measured: the first version of this script was written that way,
# passed, and was seeing none of the phase's stylesheet edits.
fail=0
# CORRECTED AFTER BEING SHOWN GREEN AGAINST THE DANGEROUS STATE (R-037a).
# The first version of this pattern ended with a SPACE inside the quotes,
# after the closing parenthesis, so every alternative silently required a
# space to follow it. It was green against an injected #b22222 under
# src/app/, which is precisely the state it exists to redden, and it was
# green for the same reason a guard that tests existence rather than
# freshness is green: it was matching something other than what it claimed.
# The witnesses below the script now run both directions before it is
# trusted.
# WIDENED after a clean-room review probed both patterns in both directions
# and found them blind to "1PX", "12Px", "color: RED", "color: navy",
# "color: lightgray" and color-mix(). CSS units and colour keywords are
# case-insensitive and the named-colour set has 148 members, of which the
# first version listed sixteen. Both greps now fold case, the colour list is
# the full CSS named set, and the length pattern covers every absolute and
# relative unit rather than three of them. The review also scanned this
# branch's added lines for exactly the missed shapes and found none, so the
# green this reported was a true statement about this tree; the widening is
# so that it stays true of the next one.
NAMED='aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen'
# WIDENED AGAIN IN ROUND TWO, and this time for the FILE TYPE THE GATE
# MOSTLY READS. Two clean-room lanes found the same file blind in three more
# ways, and the cause each time was that a pattern described CSS notation
# while the gate is scoped to src/app and src/modules/*/ui, which are
# overwhelmingly TSX:
#   1. The named-colour arm was ":[[:space:]]*(NAMED)[[:space:];]", so the
#      keyword had to follow a COLON and be followed by whitespace or a
#      semicolon. Every JavaScript and JSX way of writing one puts a QUOTE
#      there instead: { color: "red" }, style={{ color: "crimson" }}.
#      Adding 148 keywords in round one did not touch this, so the comment
#      claiming the blindness was closed was false (finding CR-P14C2-04).
#   2. Tailwind's arbitrary-value form has no colon at all:
#      className="text-[red] border-[navy]".
#   3. React renders a BARE NUMBER in an inline style as a pixel length, so
#      style={{ padding: 4 }} is a spacing literal whose source text
#      contains no unit at all and cannot match LENGTH (finding CR-H2-04).
#      Not reachable in this tree today, because no file under these paths
#      uses inline styles; guarded so it stays that way.
# POSIX BRACKET EXPRESSIONS, not regex escapes: a backslash inside [] is a
# LITERAL backslash, and a ] must be the FIRST character to be literal. The
# first form of this line wrote [\"'\]] and so required a backslash before a
# closing bracket, matching nothing. Opening delimiters: quote or bracket.
# Closing delimiters: bracket or quote.
QUOTED="[\"'[]($NAMED)[]\"']"
COLOUR="oklch\(|oklab\(|color-mix\(|#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|:[[:space:]]*($NAMED)[[:space:];]|$QUOTED"
LENGTH='[0-9.]+(px|rem|em|vw|vh|vmin|vmax|ch|ex|pt|pc|cm|mm|in|q)\b'
# React inline style with a unitless number, which IS a pixel length.
# The permitted exception is named rather than left implicit: the CSS
# properties that are genuinely unitless keep their bare numbers.
UNITLESS_OK='(lineHeight|flex|flexGrow|flexShrink|order|zIndex|opacity|fontWeight|zoom|tabSize|columnCount|widows|orphans|gridRow|gridColumn|animationIterationCount)'
INLINE_NUM='style=\{\{[^}]*[^A-Za-z]([0-9]+)[,}[:space:]]'
while IFS= read -r file; do
  case "$file" in
    src/app/*|src/modules/*/ui/*) ;;
    *) continue;;
  esac
  [ -f "$file" ] || continue
  # Added or changed lines only, with the leading + of the unified diff
  # stripped, and the +++ header line dropped.
  # BOTH GREPS IN THE SAME DIALECT, and this is a MECHANISM rather than a
  # typo: a plus written \+ is a LITERAL PLUS under -E and a ONE-OR-MORE
  # QUANTIFIER under basic grep, so the second filter here, written without
  # -E while the first had it, matched on a quantifier with nothing to
  # quantify and dropped EVERY line. Measured: 102 added lines in, 0 out,
  # and the guard reported clean over an injected colour literal. Any
  # pipeline that mixes the two dialects over the same escaped text has the
  # same defect, so both are pinned to -E.
  added="$(git diff -U0 "$base" -- "$file" | grep -E '^\+' | grep -Ev '^\+\+\+' | sed 's/^+//')"
  [ -n "$added" ] || continue
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    # EXCEPTION 2, applied by STRIPPING THE COMMENT rather than by skipping
    # the whole line. Skipping the line lets a real offender hide behind a
    # trailing comment, which is a hole a reviewer would find and an author
    # would not: what is excepted is a value written INSIDE a comment, not a
    # value on a line that happens to carry one.
    # THE DOUBLE SLASH IS ONLY A COMMENT WHEN IT DOES NOT FOLLOW A COLON.
    # The previous form stripped from the first "//" anywhere on the line, so
    # a URL in a string ate the rest of it: measured, `const probe =
    # "https://x.example/a"; const p2 = { padding: "12px" };` reported clean
    # (finding CR-P14C2-04, last case). Anchoring to start-of-line or
    # whitespace leaves "https://" alone, because a colon is neither.
    code="$(printf '%s' "$line" \
      | sed -E -e 's|/\*.*\*/||g' -e 's|/\*.*$||' -e 's|^[[:space:]]*\*.*$||' \
               -e 's@(^|[[:space:]])//.*$@\1@')"
    [ -n "$code" ] || continue
    inline_offender=0
    if printf '%s' "$code" | grep -qE "$INLINE_NUM"; then
      printf '%s' "$code" | grep -qE "$UNITLESS_OK" || inline_offender=1
    fi
    if printf '%s' "$code" | grep -qiE "$COLOUR" || \
       printf '%s' "$code" | grep -qiE "$LENGTH" || \
       [ "$inline_offender" -eq 1 ]; then
      printf '%s: added line carries a colour literal or a px/rem/em length: %s\n' "$file" "$code" >&2
      fail=1
    fi
  done <<< "$added"
done < <(git diff --name-only "$base")
# Exception 1 is structural: styles/tokens.css is not under src/, so a token
# DEFINITION is never reached by the loop above. Said here rather than left
# implied, because "it does not match" and "it is excepted" are different
# facts and only one of them survives an edit to the path filter.
[ "$fail" -eq 0 ] && echo "gate:diff-tokens clean (src/app and src/modules/*/ui, added lines only)"
exit "$fail"
