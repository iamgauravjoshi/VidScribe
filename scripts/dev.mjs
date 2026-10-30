import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDirectory = path.join(rootDirectory, 'backend');
const frontendDirectory = path.join(rootDirectory, 'frontend');
const backendRequire = createRequire(path.join(backendDirectory, 'package.json'));
const frontendRequire = createRequire(path.join(frontendDirectory, 'package.json'));

const processes = [];
let shuttingDown = false;
let exitCode = 0;

function start(name, cwd, executable, args = []) {
  const child = spawn(process.execPath, [executable, ...args], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  processes.push({ name, child });

  child.once('error', (error) => {
    console.error(`[${name}] Failed to start: ${error.message}`);
    stop(1);
  });

  child.once('exit', (code, signal) => {
    if (shuttingDown) return;

    if (code !== 0 || signal) {
      exitCode = code ?? 1;
      console.error(`[${name}] Stopped (${signal ?? `exit ${code}`}); stopping the other service.`);
    } else {
      console.log(`[${name}] Stopped; stopping the other service.`);
    }

    stop(exitCode);
  });
}

function stop(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;

  for (const { child } of processes) {
    if (child.exitCode === null && !child.killed) child.kill();
  }

  Promise.all(processes.map(({ child }) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
  }))).finally(() => {
    process.exit(exitCode);
  });
}

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));

try {
  const tsxCli = backendRequire.resolve('tsx/cli');
  const vitePackage = frontendRequire.resolve('vite/package.json');
  const viteCli = path.join(path.dirname(vitePackage), 'bin', 'vite.js');

  console.log('Starting VidScribe API and web app. Press Ctrl+C to stop both.');
  start('API', backendDirectory, tsxCli, ['watch', 'src/server.ts']);
  start('WEB', frontendDirectory, viteCli);
} catch (error) {
  console.error('Workspace dependencies are missing. Run `npm install` from the repository root.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
