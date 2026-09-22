import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // Khớp với alias "@/*" -> "./src/*" trong tsconfig.json.
    // Dùng đuôi .mts để Vite nạp file này như ESM (tránh cảnh báo configLoader).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
