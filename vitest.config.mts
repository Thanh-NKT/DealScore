import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // tests/db cần Supabase local — chạy riêng bằng pnpm test:db.
    exclude: [...configDefaults.exclude, "tests/db/**"],
  },
  resolve: {
    // Khớp với alias "@/*" -> "./src/*" trong tsconfig.json.
    // Dùng đuôi .mts để Vite nạp file này như ESM (tránh cảnh báo configLoader).
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside the react-server condition; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
