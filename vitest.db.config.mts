import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Nạp .env.local vào process.env trước khi test chạy (Node ≥ 20.12).
try {
  process.loadEnvFile(".env.local");
} catch {
  // Không có file thì helpers.ts sẽ báo thiếu biến.
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    // Các test cùng ghi vào một DB — chạy tuần tự cho dễ đọc lỗi.
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
