import { open, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const KEY_LENGTH = 32;
const keyPromises = new Map<string, Promise<Buffer>>();

export function getLocalSecretKeyPath(): string {
  const configuredDirectory = process.env.VIDSCRIBE_CONFIG_DIR;
  const userConfigRoot =
    process.env.LOCALAPPDATA ??
    process.env.XDG_CONFIG_HOME ??
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'));
  const applicationDirectory = configuredDirectory ?? path.join(userConfigRoot, 'VidScribe');

  return path.join(applicationDirectory, 'secret-encryption-key.bin');
}

async function readKeyFile(keyPath: string): Promise<Buffer | null> {
  try {
    const key = await readFile(keyPath);
    return key.length === KEY_LENGTH ? key : null;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function loadOrCreateKey(keyPath: string): Promise<Buffer> {
  await mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const existingKey = await readKeyFile(keyPath);
    if (existingKey) return existingKey;

    try {
      const handle = await open(keyPath, 'wx', 0o600);
      const key = randomBytes(KEY_LENGTH);
      try {
        await handle.writeFile(key);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return key;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }

      // Another API process may have won the exclusive-create race and still
      // be writing the key. Retry the read briefly before reporting corruption.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw new Error('The local VidScribe encryption key could not be read or created.');
}

export function getLocalSecretEncryptionKey(keyPath = getLocalSecretKeyPath()): Promise<Buffer> {
  const existing = keyPromises.get(keyPath);
  if (existing) return existing;

  const pending = loadOrCreateKey(keyPath).catch((error: unknown) => {
    keyPromises.delete(keyPath);
    throw error;
  });
  keyPromises.set(keyPath, pending);
  return pending;
}
