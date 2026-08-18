// The one StatementParser adapter: the generic delimited-file parser
// driven entirely by a SourceProfileSpec. There are no per-bank parsers
// and none may be added (pulse-domain section 5). Pure functions, no
// writes, no database.

import { detectSourceProfile } from "../domain/detect-profile";
import { parseStatement } from "../domain/parse-statement";
import type { StatementParser } from "../application/ports";

export const delimitedFileParser: StatementParser = {
  detect: detectSourceProfile,
  parse: parseStatement,
};
