// Byte-level and line-level plumbing for delimited statement files:
// decoding, line splitting that PRESERVES the original line text (rawLine
// is a stored fact, so the split must be able to hand back the exact
// source line), and field splitting that respects double-quoted fields.

import type { Delimiter, FileEncoding } from "./source-profile";

export const decodeStatementBytes = (
  bytes: Uint8Array,
  encoding: FileEncoding,
): string => new TextDecoder(encoding).decode(bytes);

// Is this byte sequence valid UTF-8? TextDecoder in fatal mode is the
// authoritative answer; Windows-1252 files with accented characters fail
// it, which is how encoding detection decides.
export const isValidUtf8 = (bytes: Uint8Array): boolean => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

// Split into lines, dropping the trailing newline but keeping each line's
// exact text (carriage returns stripped: they are line-ending bytes, not
// content). Trailing empty lines are dropped; interior empty lines are
// kept so header row indexes stay aligned with what the user sees.
export const splitLines = (text: string): string[] => {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
};

// Split one line into fields. Double quotes delimit fields that contain
// the delimiter; a doubled quote inside a quoted field is a literal quote
// (RFC 4180 shape, which Belgian exports follow when they quote at all).
export const splitDelimitedLine = (
  line: string,
  delimiter: Delimiter,
): string[] => {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }
    if (char === '"' && current === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      fields.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += char;
    i += 1;
  }
  fields.push(current);
  return fields;
};
