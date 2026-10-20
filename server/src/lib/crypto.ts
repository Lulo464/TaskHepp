import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

export function hmacSha256(secret: string, body: string | Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
