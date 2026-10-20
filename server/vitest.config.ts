import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files share one database and reset its schema, so they must not overlap.
    fileParallelism: false,
  },
});
