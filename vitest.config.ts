import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests import workspace source so they do not depend on a prior `dist/` build.
      "@routinecast/shared": fileURLToPath(new URL("./shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["shared/test/**/*.test.ts", "app/test/**/*.test.ts", "agent/test/**/*.test.ts"],
    testTimeout: 120_000, // E2E stitch runs real ffmpeg
  },
});
