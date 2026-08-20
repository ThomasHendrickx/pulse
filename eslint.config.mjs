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
    files: ["src/modules/**/ui/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": "error",
    },
  },
];

export default eslintConfig;
