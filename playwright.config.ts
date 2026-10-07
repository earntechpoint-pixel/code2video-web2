import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    headless: true,
  },
  webServer: {
    command: 'npm run dev:server',
    url: 'http://127.0.0.1:3001/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
