// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10000,
    include: ['test/**/*.test.ts'],
  },
});
