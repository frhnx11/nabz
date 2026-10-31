import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url));

const shared = {
  resolve: {
    alias: { "@": src, "server-only": serverOnlyStub },
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
          // Force UTC so tests catch timezone bugs the developer's IST machine would hide.
          env: { TZ: "UTC" },
        },
      },
      {
        ...shared,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          env: { TZ: "UTC" },
          setupFiles: ["tests/db/setup-env.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          fileParallelism: false,
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
