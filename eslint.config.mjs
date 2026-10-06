import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// DESIGN.md is enforced, not remembered: font sizes and radii come from the @theme scale in
// src/app/globals.css (text-label, rounded-tile, …). A new step goes into DESIGN.md + globals.css.
const ARBITRARY_SIZE = String.raw`(?:^|[\s"'\x60:])(?:text-\[\d*(?:\.\d+)?(?:px|rem|em)\]|rounded(?:-[a-z]{1,2})?-\[\d+px\]|rounded-xl(?:\s|$)|font-\[family-name)`;
const DESIGN_TOKEN_MESSAGE =
  "Use the design-token scale (text-label, text-body-sm…, rounded-sm/md/tile/lg…, the `display` utility) instead of arbitrary font sizes, radii or font families. See DESIGN.md.";

// Colors come from tokens (bg-surface, text-ink, …), redefined for dark mode in globals.css. A hex class
// or a fixed white/black breaks the dark theme (DESIGN.md, .impeccable/ui-conventions.md). No "/" in the
// pattern: it sits inside an esquery /regex/.
const RAW_COLOR = String.raw`(?:^|[\s"'\x60:])(?:[a-z]+(?:-[a-z]+)*-\[#[0-9a-fA-F]{3,8}\]|(?:text|bg|border|fill|stroke)-(?:white|black))(?![\w-])`;
const RAW_COLOR_MESSAGE =
  "Use a color token (bg-surface, text-ink, text-on-primary, border-line…) instead of a hex value or white/black: they break dark mode. See DESIGN.md.";
const SIZE_RULES = [
  { selector: `Literal[value=/${ARBITRARY_SIZE}/]`, message: DESIGN_TOKEN_MESSAGE },
  { selector: `TemplateElement[value.raw=/${ARBITRARY_SIZE}/]`, message: DESIGN_TOKEN_MESSAGE },
];
const COLOR_RULES = [
  { selector: `Literal[value=/${RAW_COLOR}/]`, message: RAW_COLOR_MESSAGE },
  { selector: `TemplateElement[value.raw=/${RAW_COLOR}/]`, message: RAW_COLOR_MESSAGE },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    // Open Graph images render outside the Tailwind CSS pipeline and use inline styles.
    ignores: ["src/**/opengraph-image.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...SIZE_RULES, ...COLOR_RULES],
    },
  },
  {
    // Marketplace brand colours (DESIGN.md "Màu sàn") are the one sanctioned hex palette.
    files: ["src/components/product/marketplace.ts"],
    rules: { "no-restricted-syntax": ["error", ...SIZE_RULES] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
