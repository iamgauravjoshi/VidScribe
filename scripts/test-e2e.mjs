import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDirectory = path.join(rootDirectory, 'backend');
const composeArgs = ['compose', '-f', 'docker-compose.test.yml'];
const rootRequire = createRequire(path.join(rootDirectory, 'package.json'));
const npmCli = process.env.npm_execpath;
const playwrightEntry = rootRequire.resolve('@playwright/test');
const playwrightCli = path.join(path.dirname(playwrightEntry), 'cli.js');
let startedTestDatabase = false;
let exitCode = 0;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDirectory,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell: options.shell ?? false,
    });
    let stdout = '';

    if (child.stdout) child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${signal ?? code}.`));
    });
  });
}

async function runNpm(args, options = {}) {
  if (npmCli) return run(process.execPath, [npmCli, ...args], options);
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return run(npmCommand, args, { ...options, shell: process.platform === 'win32' });
}

try {
  const existingContainer = await run('docker', [...composeArgs, 'ps', '-q', 'postgres-test'], { capture: true });
  if (!existingContainer.trim()) {
    await run('docker', [...composeArgs, 'up', '-d', '--wait']);
    startedTestDatabase = true;
  } else {
    process.stdout.write('Reusing the already-running isolated VidScribe test database.\n');
  }

  const publishedPort = await run('docker', [...composeArgs, 'port', 'postgres-test', '5432'], { capture: true });
  const portMatch = publishedPort.trim().match(/:(\d+)$/);
  if (!portMatch) throw new Error('Could not determine the isolated test database port.');

  const postgresPort = Number(portMatch[1]);
  const testEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    VIDSCRIBE_TEST_DATABASE_URL: `postgresql://vidscribe_test:vidscribe_test@127.0.0.1:${postgresPort}/vidscribe_test`,
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: String(postgresPort),
    POSTGRES_DB: 'vidscribe_test',
    POSTGRES_USER: 'vidscribe_test',
    POSTGRES_PASSWORD: 'vidscribe_test',
    E2E_API_PORT: process.env.E2E_API_PORT ?? '8218',
    E2E_FRONTEND_PORT: process.env.E2E_FRONTEND_PORT ?? '4178',
    BACKEND_PORT: process.env.E2E_API_PORT ?? '8218',
    FRONTEND_PORT: process.env.E2E_FRONTEND_PORT ?? '4178',
  };

  await runNpm(['run', 'db:migrate'], { cwd: rootDirectory, env: testEnvironment });
  process.stdout.write('Running VidScribe browser tests against the isolated test database.\n');
  await run(process.execPath, [playwrightCli, 'test', '--config=playwright.config.mts'], {
    cwd: rootDirectory,
    env: testEnvironment,
  });
} catch (error) {
  exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  if (startedTestDatabase) {
    try {
      await run('docker', [...composeArgs, 'down']);
      process.stdout.write('Stopped the test PostgreSQL container; its named volume was preserved.\n');
    } catch (error) {
      exitCode = 1;
      process.stderr.write(`Could not stop the test PostgreSQL container: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

process.exitCode = exitCode;
