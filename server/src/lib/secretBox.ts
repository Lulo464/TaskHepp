import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Symmetric encryption for secrets stored in the database (mailbox passwords).
 * AES-256-GCM with a key derived from COOKIE_SECRET; changing that secret makes stored values unreadable.
 */
export class SecretBox {
  private key: Buffer;

  constructor(secret: string, purpose: string) {
    this.key = createHash('sha256').update(`tasklog:${purpose}:${secret}`).digest();
  }

  seal(plain: string): string {
    if (!plain) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  /** Throws when the value was sealed with another secret. */
  open(sealed: string): string {
    if (!sealed) return '';
    const [version, iv, tag, data] = sealed.split(':');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unbekanntes Format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
