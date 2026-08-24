// ONE COMMENT STRIPPER, SHARED BY EVERY SOURCE-SCANNING GUARD IN THIS TREE.
//
// WHY IT EXISTS, measured rather than assumed. Round two of this phase's
// review defeated two separate guards through their own comment handling,
// and both used the same naive replace:
//
//   text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
//
//   1. It treats the double slash INSIDE A STRING LITERAL as the start of a
//      comment and discards the rest of the line with it. A forbidden call
//      written after `const url = "https://example/x";` therefore vanishes
//      before the guard ever sees it (finding CR-P14C2-03).
//   2. It knows nothing of SQL. A predicate deleted from a WHERE clause and
//      left on a `-- ...` line inside a template literal is still present in
//      the text, so a guard looking for the token stays green over a query
//      Postgres has stopped applying it in (finding CR-P14C2-01 witness TWO).
//
// So this is a scanner, not a regular expression. It tracks quote state, and
// inside a template literal it treats the content as SQL, where `--` starts a
// comment, while `${` returns to ordinary code so an interpolated identifier
// is never mistaken for prose.
//
// Comments are replaced by spaces rather than removed, so every surviving
// character keeps its offset. Guards that report a line number, or that slice
// by index, stay correct against the original text.

type Mode = "code" | "line" | "block" | "single" | "double" | "template";

export const stripComments = (text: string): string => {
  const out: string[] = [];
  // A stack so `${ ... }` inside a template returns to the template after it,
  // and a template inside that interpolation nests correctly.
  const stack: Mode[] = ["code"];
  let braceDepth = 0;
  const depths: number[] = [];
  let i = 0;

  const mode = (): Mode => stack[stack.length - 1] ?? "code";
  const keep = (n = 1): void => {
    out.push(text.slice(i, i + n));
    i += n;
  };
  const blank = (n = 1): void => {
    out.push(" ".repeat(n));
    i += n;
  };

  while (i < text.length) {
    const ch = text[i] ?? "";
    const next = text[i + 1] ?? "";
    const current = mode();

    if (current === "line") {
      if (ch === "\n") {
        stack.pop();
        keep();
      } else {
        blank();
      }
      continue;
    }
    if (current === "block") {
      if (ch === "*" && next === "/") {
        stack.pop();
        blank(2);
      } else {
        // Newlines are preserved so line numbers survive.
        if (ch === "\n") keep();
        else blank();
      }
      continue;
    }
    if (current === "single" || current === "double") {
      const quote = current === "single" ? "'" : '"';
      if (ch === "\\") {
        keep(2);
      } else if (ch === quote) {
        stack.pop();
        keep();
      } else {
        keep();
      }
      continue;
    }
    if (current === "template") {
      if (ch === "\\") {
        keep(2);
      } else if (ch === "`") {
        stack.pop();
        keep();
      } else if (ch === "$" && next === "{") {
        // Back to ordinary code for the interpolation.
        stack.push("code");
        depths.push(braceDepth);
        braceDepth = 0;
        keep(2);
      } else if (ch === "-" && next === "-") {
        // SQL line comment. The template body in this codebase is SQL.
        stack.push("line");
        blank(2);
      } else {
        keep();
      }
      continue;
    }

    // Ordinary code.
    if (ch === "/" && next === "/") {
      stack.push("line");
      blank(2);
    } else if (ch === "/" && next === "*") {
      stack.push("block");
      blank(2);
    } else if (ch === "'") {
      stack.push("single");
      keep();
    } else if (ch === '"') {
      stack.push("double");
      keep();
    } else if (ch === "`") {
      stack.push("template");
      keep();
    } else if (ch === "{") {
      braceDepth += 1;
      keep();
    } else if (ch === "}") {
      if (braceDepth === 0 && stack.length > 1) {
        // Closes a `${ ... }` and returns to the enclosing template.
        stack.pop();
        braceDepth = depths.pop() ?? 0;
        keep();
      } else {
        braceDepth -= 1;
        keep();
      }
    } else {
      keep();
    }
  }

  return out.join("");
};
