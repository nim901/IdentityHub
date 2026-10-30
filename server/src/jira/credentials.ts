import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function parseEncryptionKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('Invalid encryption key');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('Invalid encryption key');
  return key;
}

export function encryptToken(key: Buffer, userId: string, kind: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`identityhub:jira:${kind}:${userId}`));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptToken(key: Buffer, userId: string, kind: string, value: string): string {
  const [version, iv, tag, data, extra] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !data || extra !== undefined) throw new Error('Invalid encrypted credential');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(`identityhub:jira:${kind}:${userId}`));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
