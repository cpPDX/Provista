const { defineConfig, devices } = require('@playwright/test');

const STAGING_ORIGIN = 'https://provista-staging.up.railway.app';
const baseURL = process.env.MARKETING_CAPTURE_BASE_URL || STAGING_ORIGIN;

if (baseURL !== STAGING_ORIGIN) {
  throw new Error(`Marketing capture is restricted to staging: ${STAGING_ORIGIN}`);
}

module.exports = defineConfig({
  testDir: './tests/marketing',
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 120000,
  retries: 0,
  workers: 1,
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    baseURL,
    headless: true,
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    extraHTTPHeaders: {
      'x-provista-timezone': 'America/Los_Angeles'
    },
    screenshot: 'off',
    trace: 'off',
    video: 'off'
  }
});
