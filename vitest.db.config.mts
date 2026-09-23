import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Load .env.local into process.env before tests run (Node ≥ 20.12).
try {
  process.loadEnvFile(".env.local");
} catch {
  // Without the file, helpers.ts reports the missing variables.
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    // Tests write to the same DB — run them serially so failures are easy to read.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside the react-server condition; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
