import { describe, it, expect, beforeAll } from 'vitest';
import { encryptCookie, decryptCookie } from '../crypto';

beforeAll(() => {
  // Set a test secret
  process.env.NEXTAUTH_SECRET = 'test-secret-key-for-unit-tests-only';
});

describe('encryptCookie / decryptCookie', () => {
  it('should roundtrip encrypt and decrypt', () => {
    const plaintext = 's%3Aabc123def456.somesignature';
    const encrypted = encryptCookie(plaintext);
    const decrypted = decryptCookie(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertexts for the same input (random IV)', () => {
    const plaintext = 'same-cookie-value';
    const enc1 = encryptCookie(plaintext);
    const enc2 = encryptCookie(plaintext);
    expect(enc1).not.toBe(enc2);

    // But both decrypt to the same value
    expect(decryptCookie(enc1)).toBe(plaintext);
    expect(decryptCookie(enc2)).toBe(plaintext);
  });

  it('should handle empty string', () => {
    const encrypted = encryptCookie('');
    const decrypted = decryptCookie(encrypted);
    expect(decrypted).toBe('');
  });

  it('should handle long cookie values', () => {
    const long = 'x'.repeat(10_000);
    const encrypted = encryptCookie(long);
    const decrypted = decryptCookie(encrypted);
    expect(decrypted).toBe(long);
  });

  it('should handle unicode characters', () => {
    const unicode = 'cookie-with-émojis-🎉-and-中文';
    const encrypted = encryptCookie(unicode);
    const decrypted = decryptCookie(encrypted);
    expect(decrypted).toBe(unicode);
  });

  it('should throw on invalid encrypted format', () => {
    expect(() => decryptCookie('not-valid')).toThrow('Invalid encrypted cookie format');
    expect(() => decryptCookie('only:two')).toThrow('Invalid encrypted cookie format');
  });

  it('should throw on tampered ciphertext', () => {
    const encrypted = encryptCookie('test-value');
    const parts = encrypted.split(':');
    // Tamper with the ciphertext
    parts[1] = Buffer.from('tampered').toString('base64');
    expect(() => decryptCookie(parts.join(':'))).toThrow();
  });

  it('should throw if NEXTAUTH_SECRET is missing', () => {
    const saved = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(() => encryptCookie('test')).toThrow('NEXTAUTH_SECRET is required');
    } finally {
      process.env.NEXTAUTH_SECRET = saved;
    }
  });

  it('should produce base64-encoded output with colon separators', () => {
    const encrypted = encryptCookie('test');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);

    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow();
      expect(Buffer.from(part, 'base64').toString('base64')).toBe(part);
    }
  });
});
