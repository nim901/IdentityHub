import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('runs the read-only discovery command using only an injected fake transport', () => {
  const fake = new URL('./fixtures/fake-blog-transport.mjs', import.meta.url).href;
  const cli = fileURLToPath(new URL('../src/digest/discover-cli.ts', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', fake, cli], { encoding: 'utf8', timeout: 12000, env: { ...process.env, IDENTITYHUB_FAKE_BLOCKED: '' } });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({ url: 'https://www.oasis.security/blog/fake-post', title: 'Fake post', datePublished: '2025-01-02', sameDayCount: 1 });
}, 15000);

it('exits safely when the fake robots policy blocks discovery', () => {
  const fake = new URL('./fixtures/fake-blog-transport.mjs', import.meta.url).href;
  const cli = fileURLToPath(new URL('../src/digest/discover-cli.ts', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', fake, cli], { encoding: 'utf8', timeout: 12000, env: { ...process.env, IDENTITYHUB_FAKE_BLOCKED: '1' } });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Blog discovery failed.');
}, 15000);
