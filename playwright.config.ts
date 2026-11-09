import { defineConfig, devices } from '@playwright/test';
const external = process.env.ASKI_TEST_URL;
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1,
  use: { baseURL: external || 'http://127.0.0.1:4179', trace: 'retain-on-failure' },
  webServer: external ? undefined : { command: 'npm run preview -- --port 4179 --strictPort', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'tablet', use: { browserName: 'webkit', viewport: { width: 768, height: 1024 } } },
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});
