import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.join(rootDirectory, 'backend');
const frontendDirectory = path.join(rootDirectory, 'frontend');
const backendRequire = createRequire(path.join(backendDirectory, 'package.json'));
const frontendRequire = createRequire(path.join(frontendDirectory, 'package.json'));
const tsxCli = backendRequire.resolve('tsx/cli');
const vitePackage = frontendRequire.resolve('vite/package.json');
const viteCli = path.join(path.dirname(vitePackage), 'bin', 'vite.js');
const apiPort = Number(process.env.E2E_API_PORT) || 8218;
const frontendPort = Number(process.env.E2E_FRONTEND_PORT) || 4178;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;

function quoteCommandArgument(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

const inheritedEnvironment: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
const serverEnvironment = {
  ...inheritedEnvironment,
  NODE_ENV: 'test',
  BACKEND_PORT: String(apiPort),
  FRONTEND_PORT: String(frontendPort),
};

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: frontendUrl,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `${quoteCommandArgument(process.execPath)} ${quoteCommandArgument(tsxCli)} test/e2e-api-server.ts`,
      cwd: backendDirectory,
      url: `${apiUrl}/api/sources`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnvironment,
    },
    {
      command: `${quoteCommandArgument(process.execPath)} ${quoteCommandArgument(viteCli)} --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      cwd: frontendDirectory,
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 30_000,
      env: serverEnvironment,
    },
  ],
});
