import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // tests/db needs a local Supabase — run it separately with pnpm test:db.
    exclude: [...configDefaults.exclude, "tests/db/**"],
  },
  resolve: {
    // Matches the "@/*" -> "./src/*" alias in tsconfig.json.
    // The .mts extension makes Vite load this file as ESM (avoids a configLoader warning).
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside the react-server condition; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
