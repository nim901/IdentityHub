import { expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/database.js';
import { encryptToken } from '../src/jira/credentials.js';

it('runs the real digest CLI with isolated data and only fake providers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'identityhub-digest-test-'));
  try {
    const path = join(dir, 'test.db'), key = Buffer.alloc(32, 7);
    const db = openDatabase(path);
    db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('user', 'fake@example.test', 'fake', '2025-01-01');
    db.prepare('INSERT INTO jira_credentials (user_id, access_token_enc, refresh_token_enc, access_expires_at, scopes) VALUES (?, ?, ?, ?, ?)').run('user', encryptToken(key, 'user', 'access', 'fake-access'), encryptToken(key, 'user', 'refresh', 'fake-refresh'), '2099-01-01T00:00:00.000Z', 'read:jira-work write:jira-work');
    db.prepare('INSERT INTO jira_sites (user_id,cloud_id,site_url,site_name) VALUES (?,?,?,?)').run('user', 'site-one', 'https://one.atlassian.net', 'One');
    db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('other', 'other@example.test', 'fake', '2025-01-01');
    db.prepare('INSERT INTO jira_credentials (user_id, access_token_enc, refresh_token_enc, access_expires_at, scopes) VALUES (?, ?, ?, ?, ?)').run('other', encryptToken(key, 'other', 'access', 'fake-access'), encryptToken(key, 'other', 'refresh', 'fake-refresh'), '2099-01-01T00:00:00.000Z', 'read:jira-work write:jira-work');
    db.prepare('INSERT INTO jira_sites (user_id,cloud_id,site_url,site_name) VALUES (?,?,?,?)').run('other', 'site-one', 'https://one.atlassian.net', 'One'); db.close();
    const fake = new URL('./fixtures/fake-digest-transport.mjs', import.meta.url).href;
    const cli = fileURLToPath(new URL('../src/digest/cli.ts', import.meta.url));
    const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: process.env.HOME, DATABASE_PATH: path, DIGEST_USER_EMAIL: 'fake@example.test', DIGEST_PROJECT_KEY: 'ONE', AI_API_KEY: 'fake-key', AI_MODEL: 'fake-model', ATLASSIAN_CLIENT_ID: 'fake-id', ATLASSIAN_CLIENT_SECRET: 'fake-secret', OAUTH_REDIRECT_URI: 'http://localhost:3000/api/jira/callback', ENCRYPTION_KEY: key.toString('base64'), FAKE_PROVIDER_LOG: join(dir, 'fake-writes.log') };
    const run = (extra: Record<string, string> = {}, ...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', '--import', fake, cli, ...args], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000 });
    const dry = run({}, '--dry-run'); expect(dry.status, dry.stderr).toBe(0); expect(JSON.parse(dry.stdout)).toMatchObject({ status: 'dry-run', degraded: false });
    const codexWrite = run({}, '--codex-cli'); expect(codexWrite.status).toBe(1); expect(codexWrite.stderr).toMatch(/requires --dry-run/);
    expect(existsSync(env.FAKE_PROVIDER_LOG)).toBe(false);
    const afterDry = openDatabase(path); expect(afterDry.prepare('SELECT count(*) AS n FROM digest_posts').get()).toEqual({ n: 0 }); expect(afterDry.prepare('SELECT count(*) AS n FROM created_issues').get()).toEqual({ n: 0 }); afterDry.close();
    const degraded = run({ AI_API_KEY: '' }, '--dry-run'); expect(degraded.status, degraded.stderr).toBe(3); expect(JSON.parse(degraded.stdout)).toMatchObject({ status: 'dry-run', degraded: true });
    const required = run({ AI_API_KEY: '' }, '--dry-run', '--require-ai'); expect(required.status).toBe(1); expect(required.stdout).toBe('');
    const first = run(); expect(first.status, first.stderr).toBe(0); expect(JSON.parse(first.stdout)).toMatchObject({ status: 'created', issueKey: 'ONE-1' });
    const again = run(); expect(again.status, again.stderr).toBe(0); expect(JSON.parse(again.stdout)).toMatchObject({ status: 'already-created', issueKey: 'ONE-1' });
    expect(readFileSync(env.FAKE_PROVIDER_LOG, 'utf8').trim().split('\n')).toHaveLength(1);
    const unknown = run({ DIGEST_USER_EMAIL: 'other@example.test', FAKE_JIRA_FAIL: '1' }); expect(unknown.status).toBe(1); expect(unknown.stderr).toMatch(/outcome unknown/i);
    const retry = run({ DIGEST_USER_EMAIL: 'other@example.test' }); expect(retry.status).toBe(1); expect(retry.stderr).toMatch(/unresolved/i);
    expect(readFileSync(env.FAKE_PROVIDER_LOG, 'utf8').trim().split('\n')).toHaveLength(2);
    const check = openDatabase(path); expect(check.prepare('SELECT count(*) AS n FROM created_issues').get()).toEqual({ n: 1 }); check.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 90000);
