import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// DESIGN.md is enforced, not remembered: font sizes and radii come from the @theme scale in
// src/app/globals.css (text-label, rounded-tile, …). A new step goes into DESIGN.md + globals.css.
const ARBITRARY_SIZE = String.raw`(?:^|[\s"'\x60:])(?:text-\[\d+(?:\.\d+)?px\]|rounded(?:-[a-z]{1,2})?-\[\d+px\]|rounded-xl(?:\s|$)|font-\[family-name)`;
const DESIGN_TOKEN_MESSAGE =
  "Use the design-token scale (text-label, text-body-sm…, rounded-sm/md/tile/lg…, the `display` utility) instead of arbitrary font sizes, radii or font families. See DESIGN.md.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    // Open Graph images render outside the Tailwind CSS pipeline and use inline styles.
    ignores: ["src/**/opengraph-image.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${ARBITRARY_SIZE}/]`, message: DESIGN_TOKEN_MESSAGE },
        { selector: `TemplateElement[value.raw=/${ARBITRARY_SIZE}/]`, message: DESIGN_TOKEN_MESSAGE },
      ],
    },
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
