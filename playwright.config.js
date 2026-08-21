const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.js',
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 90000,
  retries: 1,
  use: {
    actionTimeout: 15000,
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 13'], browserName: 'chromium' }
    },
    {
      name: 'webkit-iphone',
      testMatch: /accessibility\.spec\.js/,
      use: { ...devices['iPhone 13'], browserName: 'webkit' }
    }
  ],
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:3000/api/health/ready',
    reuseExistingServer: !process.env.CI,
    // No env override — server.js loads .env itself via require('dotenv').config()
  }
});
