import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT = 'substack-cookie';
const ITERATIONS = 100_000;

function deriveKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required for cookie encryption');
  }
  return pbkdf2Sync(secret, SALT, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns base64-encoded `iv:ciphertext:tag`.
 */
export function encryptCookie(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':');
}

/**
 * Decrypt a string produced by `encryptCookie`.
 */
export function decryptCookie(encrypted: string): string {
  const key = deriveKey();
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted cookie format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const ciphertext = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}
