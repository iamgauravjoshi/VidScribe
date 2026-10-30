import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;

function assertKey(key: Uint8Array): void {
  if (key.byteLength !== KEY_LENGTH) {
    throw new Error('The VidScribe secret encryption key must contain 32 bytes.');
  }
}

export function encryptSecret(value: string, key: Uint8Array): string {
  assertKey(key);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ['v1', nonce.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(encryptedValue: string, key: Uint8Array): string {
  assertKey(key);
  const [version, nonceValue, tagValue, ciphertextValue, extraValue] = encryptedValue.split('.');

  if (version !== 'v1' || !nonceValue || !tagValue || ciphertextValue === undefined || extraValue) {
    throw new Error('The stored provider credential has an unsupported encryption format.');
  }

  const nonce = Buffer.from(nonceValue, 'base64');
  const tag = Buffer.from(tagValue, 'base64');
  const ciphertext = Buffer.from(ciphertextValue, 'base64');
  if (nonce.length !== NONCE_LENGTH || tag.length !== 16) {
    throw new Error('The stored provider credential is malformed.');
  }

  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
