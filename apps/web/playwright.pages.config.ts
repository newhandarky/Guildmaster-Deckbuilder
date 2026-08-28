import { defineConfig, devices } from '@playwright/test';

const pagesUrl = 'http://127.0.0.1:4175/Guildmaster-Deckbuilder/';

export default defineConfig({
  testDir: './e2e-pages',
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: pagesUrl, trace: 'retain-on-failure' },
  webServer: {
    command: 'node_modules/.bin/vite preview --mode github-pages --host 127.0.0.1 --port 4175',
    url: pagesUrl,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
