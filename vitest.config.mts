import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Test runner config. Mirrors tsconfig's `"@/*": ["./src/*"]` path alias so the
// same import specifiers used by the app resolve under Vitest. Regex (not the
// bare "@" string) on purpose: a `find: "@"` alias would also rewrite scoped
// packages like `@ant-design/*` to `./src/ant-design/*`.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
