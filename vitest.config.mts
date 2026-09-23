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
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
