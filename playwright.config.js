const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.js',
  timeout: 90000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    // No env override — server.js loads .env itself via require('dotenv').config()
  }
});
