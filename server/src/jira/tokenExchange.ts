import { exchangeAuthorizationCode, refreshOAuth2Token } from 'jira.js/core';
import { z } from 'zod';

const tokenSchema = z.object({
  accessToken: z.string().min(1).max(8192),
  refreshToken: z.string().min(1).max(8192),
  expiresIn: z.number().int().positive().max(315360000),
  scope: z.string().max(2048).optional(),
});

// Token exchange and offline_access: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
type TokenConfig = { clientId: string; clientSecret: string; redirectUri: string; fetch?: typeof fetch };

export function createGuardedFetch(config: { fetch?: typeof fetch }, allowed: (url: URL, method: string) => boolean, limit = 32768): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (!allowed(url, init?.method ?? 'GET')) throw new Error('Unexpected provider endpoint');
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
            if (size > limit) throw new Error('Response too large');
            chunks.push(part.value);
          }
        } finally { void reader.cancel().catch(() => {}); }
      }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: { 'content-type': 'application/json' } });
    };
    try { return await Promise.race([request(), timedOut]); }
    finally { clearTimeout(timer!); }
  };
}

const tokenEndpoint = (url: URL, method: string) => url.href === 'https://auth.atlassian.com/oauth/token' && method === 'POST';

export async function exchangeCode(config: TokenConfig, code: string) {
  const result = await exchangeAuthorizationCode({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, code, fetch: createGuardedFetch(config, tokenEndpoint) });
  return tokenSchema.parse(result);
}

// Atlassian rotates and invalidates the previous refresh token:
// https://developer.atlassian.com/cloud/oauth/getting-started/refresh-tokens/
export async function refreshTokens(config: TokenConfig, refreshToken: string) {
  const result = await refreshOAuth2Token({ clientId: config.clientId, clientSecret: config.clientSecret, refreshToken, fetch: createGuardedFetch(config, tokenEndpoint) });
  return tokenSchema.parse(result);
}
