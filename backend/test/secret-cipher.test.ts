import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { getLocalSecretEncryptionKey } from '../src/shared/secrets/local-key-store.js';
import { decryptSecret, encryptSecret } from '../src/shared/secrets/secret-cipher.js';

test('provider credentials are authenticated-encrypted and local key creation is race-safe', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vidscribe-secret-test-'));
  const keyPath = path.join(root, 'secret-encryption-key.bin');

  try {
    const [keyA, keyB] = await Promise.all([
      getLocalSecretEncryptionKey(keyPath),
      getLocalSecretEncryptionKey(keyPath),
    ]);
    assert.deepEqual(keyA, keyB);
    assert.equal((await readFile(keyPath)).length, 32);

    const secret = 'provider-api-key-value';
    const encrypted = encryptSecret(secret, keyA);
    assert.notEqual(encrypted, secret);
    assert.equal(decryptSecret(encrypted, keyA), secret);
    assert.throws(() => decryptSecret(encrypted, randomBytes(32)));

    const parts = encrypted.split('.');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
    assert.throws(() => decryptSecret(parts.join('.'), keyA));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
