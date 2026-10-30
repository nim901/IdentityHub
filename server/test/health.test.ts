import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('health', () => {
  it('returns a healthy response', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
