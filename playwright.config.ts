import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 960, height: 700 },
    headless: true,
    launchOptions: process.env.BROWSER_PATH ? {
      executablePath: process.env.BROWSER_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-zygote'],
    } : undefined,
  },
  webServer: {
    command: 'npm run dev -- --port 5173',
    env: { MIMIC_LLM_URL: '' }, // Browser tests never contact a configured paid provider.
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
