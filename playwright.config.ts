import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false, workers: 1, reporter: 'line',
  outputDir: '.tmp/ui-implementation/test-results',
  use: {
    baseURL: 'http://127.0.0.1:3918', viewport: { width: 1586, height: 992 },
    ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? { channel: 'chrome' } : {}),
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: { command: 'node --import tsx tests/browser/server.ts', url: 'http://127.0.0.1:3918', reuseExistingServer: false, timeout: 30000 },
});
