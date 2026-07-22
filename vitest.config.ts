import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const disableNodeWebStorage = process.allowedNodeEnvironmentFlags.has(
  "--no-experimental-webstorage"
)
  ? ["--no-experimental-webstorage"]
  : [];

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    poolOptions: {
      forks: { execArgv: disableNodeWebStorage },
      threads: { execArgv: disableNodeWebStorage }
    }
  }
});
