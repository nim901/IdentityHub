import { exchangeAuthorizationCode } from 'jira.js/core';
import { z } from 'zod';

const tokenSchema = z.object({
  accessToken: z.string().min(1).max(8192),
  refreshToken: z.string().min(1).max(8192),
  expiresIn: z.number().int().positive().max(315360000),
  scope: z.string().max(2048).optional(),
});

// Token exchange and offline_access: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
export async function exchangeCode(config: { clientId: string; clientSecret: string; redirectUri: string; fetch?: typeof fetch }, code: string) {
  const guardedFetch: typeof fetch = async (input, init) => {
    if (String(input) !== 'https://auth.atlassian.com/oauth/token' || init?.method !== 'POST') throw new Error('Unexpected token endpoint');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Token request timed out')); }, 10_000);
    });
    const request = async () => {
      const response = await (config.fetch ?? fetch)(input, { ...init, redirect: 'error', signal: controller.signal });
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('Unexpected redirect');
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 32768) throw new Error('Response too large');
            chunks.push(part.value);
          }
        } finally { void reader.cancel().catch(() => {}); }
      }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: { 'content-type': 'application/json' } });
    };
    try { return await Promise.race([request(), timedOut]); }
    finally { clearTimeout(timer!); }
  };
  const result = await exchangeAuthorizationCode({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, code, fetch: guardedFetch });
  return tokenSchema.parse(result);
}
