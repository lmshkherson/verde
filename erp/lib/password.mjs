import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEYLEN = 64;

/**
 * Хеш пароля у форматі scrypt$<сіль-hex>$<ключ-hex>.
 * @param {string} plain
 * @returns {Promise<string>}
 */
export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = /** @type {Buffer} */ (await scrypt(plain, salt, KEYLEN));
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/**
 * Звіряє пароль із хешем. Порівняння сталого часу, щоб не зливати інформацію таймінгом.
 * @param {string} plain
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  const actual = /** @type {Buffer} */ (
    await scrypt(plain, Buffer.from(saltHex, 'hex'), expected.length)
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
