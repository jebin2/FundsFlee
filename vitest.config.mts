import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true } as never,
  test: {
    environment: "node",
  },
});
