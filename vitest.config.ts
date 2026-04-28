import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/__mocks__/vscode.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
