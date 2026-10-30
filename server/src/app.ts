import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  app.get('/healthz', async () => ({ status: 'ok' }));
  const webRoot = resolve(fileURLToPath(new URL('../../web/dist', import.meta.url)));
  if (existsSync(webRoot)) await app.register(fastifyStatic, { root: webRoot });
  return app;
}
