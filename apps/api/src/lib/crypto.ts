import crypto from 'crypto';

/**
 * Symmetric encryption for secrets at rest (e.g. Plaid access tokens).
 *
 * - Algorithm: aes-256-cbc
 * - Key: SHA-256 hash of JWT_SECRET (yields the required 32 bytes)
 * - Serialized as "iv:ciphertext" in hex
 *
 * We never store a Plaid access token in plaintext — encrypt before persisting,
 * decrypt only in-memory when a Plaid call needs it.
 */

const ALGORITHM = 'aes-256-cbc';

function getKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured (required for encryption)');
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, dataHex] = payload.split(':');
  if (!ivHex || !dataHex) throw new Error('Malformed encrypted payload');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
