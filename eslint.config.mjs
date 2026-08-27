import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // The production-mode e2e project builds into its own dist
      // directory (PULSE_DIST_DIR, deploy-verify defect round).
      ".next-prod/**",
      "out/**",
      "test-results/**",
      "playwright-report/**",
      "supabase/**",
      "delivery/**",
      "design/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Criterion 4.4 (hazard H4.3): no user-facing string is hardcoded in
    // module UI components; every string a user sees comes from the
    // next-intl catalogs. react/jsx-no-literals (default options) forbids
    // bare text nodes in JSX under src/modules/**/ui. Deliberate glyphs
    // (arrows, separators, the euro sign) are written as expression
    // containers, which keeps them greppable as intentional exceptions.
    // WIDENED IN M3-P10 (criterion 10.11). The rule is not a grep despite
    // the name the frontend skill gives it: it is react/jsx-no-literals
    // scoped by this glob, so nothing outside the glob is covered. The
    // client leaves M3-P10 adds, and the toast M3-P11 adds over them, live
    // under src/platform/ui, which the module glob never reached.
    //
    // src/app/** IS DELIBERATELY NOT ADDED, with one reason and it is
    // measured: it fails at this phase's base on the brand word in
    // src/app/(app)/layout.tsx, which is a proper noun rather than
    // translatable copy. That half is parked rather than forgotten.
    files: ["src/modules/**/ui/**/*.tsx", "src/platform/ui/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": "error",
    },
  },
];

export default eslintConfig;
