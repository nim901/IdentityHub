import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('runs the summary preview with fake transports only', () => {
  const cli = fileURLToPath(new URL('../src/digest/preview-cli.ts', import.meta.url));
  const fake = new URL('./fixtures/fake-summary-transport.mjs', import.meta.url).href;
  process.env.IDENTITYHUB_FAKE_PRIVATE_SENTINEL = 'fake-only';
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', fake, cli], { encoding: 'utf8', timeout: 15000, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: process.env.HOME, AI_API_KEY: 'fake-key', AI_MODEL: 'fake-model' } });
  delete process.env.IDENTITYHUB_FAKE_PRIVATE_SENTINEL;
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ title: 'Fake post', summary: 'A fake summary.' });
  expect(result.stderr).toBe('');
}, 18000);
