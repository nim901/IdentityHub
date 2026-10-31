import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { runDigest } from '../src/digest/command.js';
import { FindingError } from '../src/jira/findings.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup() {
  const db = openDatabase(':memory:'); databases.push(db);
  for (const id of ['a', 'b']) db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(id, `${id}@example.test`, 'fake', '2025-01-01');
  for (const id of ['a', 'b']) {
    db.prepare('INSERT INTO jira_credentials (user_id,access_token_enc,refresh_token_enc,access_expires_at,scopes) VALUES (?,?,?,?,?)').run(id, 'fake', 'fake', '2099-01-01', 'fake');
    db.prepare('INSERT INTO jira_sites (user_id,cloud_id,site_url,site_name) VALUES (?,?,?,?)').run(id, `site-${id}`, `https://${id}.atlassian.net`, 'Fake');
  }
  const read = vi.fn(async () => ({ url: 'https://www.oasis.security/blog/fake', title: 'Fake post', datePublished: '2025-01-02', sameDayCount: 1, text: 'Fake article body.' }));
  const summarize = vi.fn(async () => 'Fake summary.');
  const create = vi.fn(async () => ({ issueKey: 'ONE-1', url: 'https://one.atlassian.net/browse/ONE-1', replay: false }));
  return { db, read, summarize, create };
}
const base = { userId: 'a', project: 'ONE', dryRun: false, requireAi: false };

it('creates once per user and post, allowing another user independently', async () => {
  const f = setup();
  expect(await runDigest({ ...f, ...base })).toMatchObject({ status: 'created', issueKey: 'ONE-1', degraded: false });
  expect(await runDigest({ ...f, ...base })).toMatchObject({ status: 'already-created', issueKey: 'ONE-1' });
  expect(await runDigest({ ...f, ...base, userId: 'b' })).toMatchObject({ status: 'created' });
  expect(f.create).toHaveBeenCalledTimes(2);
});
it('dry run creates no reservation or ticket and degraded fallback is explicit', async () => {
  const f = setup(); f.summarize.mockRejectedValue(new Error('fake model failure'));
  expect(await runDigest({ ...f, ...base, dryRun: true })).toMatchObject({ status: 'dry-run', degraded: true, summary: 'Fake article body.' });
  expect(f.create).not.toHaveBeenCalled();
  expect(f.db.prepare('SELECT count(*) AS n FROM digest_posts').get()).toEqual({ n: 0 });
  await expect(runDigest({ ...f, ...base, requireAi: true })).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled();
});
it('blocks concurrent runs and unknown outcomes without repeating a Jira write', async () => {
  const f = setup(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.create.mockImplementation(async () => { await gate; throw new Error('fake uncertain write'); });
  const first = runDigest({ ...f, ...base });
  await vi.waitFor(() => expect(f.create).toHaveBeenCalledTimes(1));
  await expect(runDigest({ ...f, ...base })).rejects.toThrow(/unresolved/i);
  release(); await expect(first).rejects.toThrow(/unknown/i);
  await expect(runDigest({ ...f, ...base })).rejects.toThrow(/unresolved/i);
  expect(f.create).toHaveBeenCalledTimes(1);
});
it('allows retry after a definite Jira rejection', async () => {
  const f = setup(); f.create.mockRejectedValueOnce(new FindingError(502, 'Jira rejected the finding.', undefined, true));
  await expect(runDigest({ ...f, ...base })).rejects.toThrow();
  expect(await runDigest({ ...f, ...base })).toMatchObject({ status: 'created' });
  expect(f.create).toHaveBeenCalledTimes(2);
});

it('reports a known created issue if local recording fails and blocks another write', async () => {
  const f = setup(); f.create.mockRejectedValueOnce(new FindingError(502, 'Jira created the issue, but local recording failed. Do not retry.', 'ONE-7'));
  await expect(runDigest({ ...f, ...base })).rejects.toThrow(/ONE-7/);
  await expect(runDigest({ ...f, ...base })).rejects.toThrow(/unresolved/i);
  expect(f.create).toHaveBeenCalledTimes(1);
});
it('rejects a different user and invalid project before provider work', async () => {
  const f = setup();
  await expect(runDigest({ ...f, ...base, userId: 'absent' })).rejects.toThrow();
  await expect(runDigest({ ...f, ...base, project: 'invalid project' })).rejects.toThrow();
  expect(f.read).not.toHaveBeenCalled();
});

it('treats invalid model output as unavailable and never silently labels it as AI', async () => {
  const f = setup(); f.summarize.mockResolvedValue('   ');
  expect(await runDigest({ ...f, ...base, dryRun: true })).toMatchObject({ status: 'dry-run', degraded: true, summary: 'Fake article body.' });
  await expect(runDigest({ ...f, ...base, dryRun: true, requireAi: true })).rejects.toThrow();
});

it('marks a stale pending reservation unknown and still blocks retry', async () => {
  const f = setup();
  f.db.prepare("INSERT INTO digest_posts (user_id,post_url,status,created_at) VALUES (?,?, 'pending', ?)").run('a', 'https://www.oasis.security/blog/fake', '2000-01-01T00:00:00.000Z');
  await expect(runDigest({ ...f, ...base })).rejects.toThrow(/unresolved/i);
  expect(f.db.prepare('SELECT status FROM digest_posts WHERE user_id = ?').get('a')).toEqual({ status: 'unknown' });
  expect(f.create).not.toHaveBeenCalled();
});

it('binds creation to the selected site captured before discovery', async () => {
  const f = setup();
  f.read.mockImplementation(async () => {
    f.db.prepare("UPDATE jira_sites SET cloud_id = 'site-other' WHERE user_id = 'a'").run();
    return { url: 'https://www.oasis.security/blog/fake', title: 'Fake post', datePublished: '2025-01-02', sameDayCount: 1, text: 'Fake article body.' };
  });
  await runDigest({ ...f, ...base });
  expect(f.create.mock.calls[0][3]).toBe('site-a');
});

it('releases the reservation and explains a confirmed site change without claiming a Jira rejection', async () => {
  const f = setup(); f.create.mockRejectedValueOnce(new FindingError(409, 'Jira site changed.', undefined, true));
  await expect(runDigest({ ...f, ...base })).rejects.toThrow('Jira site changed. No issue was created.');
  expect(f.db.prepare('SELECT count(*) AS n FROM digest_posts').get()).toEqual({ n: 0 });
  expect(await runDigest({ ...f, ...base })).toMatchObject({ status: 'created' });
});

it('classifies a shared-service site mismatch as a definite no-write result', async () => {
  const f = setup();
  const { FindingsService } = await import('../src/jira/findings.js');
  const connection = { clientFor: async () => ({ site: { cloud_id: 'site-other', site_url: 'https://other.atlassian.net' }, client: {}, credentialVersion: 'fake', canWrite: true }) };
  const service = new FindingsService(f.db, connection as unknown as ConstructorParameters<typeof FindingsService>[1]);
  await expect(service.create({ kind: 'digest', userId: 'a' }, { project: 'ONE', title: 'Fake', description: 'Fake' }, 'digest-fake-key-123', 'site-a')).rejects.toMatchObject({ status: 409, message: 'Jira site changed.', definiteRejection: true });
  expect(f.db.prepare('SELECT count(*) AS n FROM finding_operations').get()).toEqual({ n: 0 });
});
