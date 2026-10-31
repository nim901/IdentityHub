import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { FindingError, type FindingActor, type FindingInput } from '../jira/findings.js';
import type { PostMetadata } from './discovery.js';

type Article = PostMetadata & { sameDayCount: number; text: string };
type Options = {
  db: Database.Database; userId: string; project: string; dryRun: boolean; requireAi: boolean;
  read: () => Promise<Article>; summarize?: (text: string) => Promise<string>;
  create: (actor: FindingActor, input: FindingInput, key: string, siteId: string) => Promise<{ issueKey: string; url: string; replay: boolean }>;
};

export async function runDigest(options: Options) {
  if (!options.db.prepare('SELECT 1 FROM users WHERE id = ?').get(options.userId) || !/^[A-Z][A-Z0-9_]{0,31}$/.test(options.project)) throw new Error('Invalid digest user or project');
  const selected = options.dryRun ? undefined : options.db.prepare('SELECT cloud_id FROM jira_sites WHERE user_id = ?').get(options.userId) as { cloud_id: string } | undefined;
  if (!options.dryRun && !selected) throw new Error('Jira site not selected');
  const post = await options.read();
  if (!options.dryRun) options.db.prepare("UPDATE digest_posts SET status = 'unknown' WHERE user_id = ? AND post_url = ? AND status = 'pending' AND datetime(created_at) <= datetime('now', '-30 minutes')").run(options.userId, post.url);
  const previous = options.db.prepare('SELECT status, issue_key, issue_url FROM digest_posts WHERE user_id = ? AND post_url = ?').get(options.userId, post.url) as { status: string; issue_key: string | null; issue_url: string | null } | undefined;
  if (!options.dryRun && previous) {
    if (previous.status === 'done' && previous.issue_key && previous.issue_url) return { status: 'already-created' as const, issueKey: previous.issue_key, url: previous.issue_url };
    throw new Error('Earlier digest outcome unresolved. Check Jira before retrying.');
  }
  let summary: string;
  let degraded = false;
  try {
    if (!options.summarize) throw new Error('Model unavailable');
    summary = (await options.summarize(post.text)).trim();
    if (!summary || summary.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(summary)) throw new Error('Invalid model output');
  }
  catch { if (options.requireAi) throw new Error('AI summary unavailable'); degraded = true; summary = post.text.slice(0, 1500).trim(); }
  if (!summary || summary.length > 5000) throw new Error('Invalid summary');
  if (options.dryRun) return { status: 'dry-run' as const, post: { url: post.url, title: post.title, datePublished: post.datePublished, sameDayCount: post.sameDayCount }, summary, degraded };
  const inserted = options.db.prepare("INSERT INTO digest_posts (user_id,post_url,status) VALUES (?,?,'pending') ON CONFLICT(user_id,post_url) DO NOTHING").run(options.userId, post.url);
  if (!inserted.changes) throw new Error('Earlier digest outcome unresolved. Check Jira before retrying.');
  const key = `digest-${createHash('sha256').update(post.url).digest('hex')}`;
  let result: { issueKey: string; url: string; replay: boolean };
  try {
    result = await options.create({ kind: 'digest', userId: options.userId }, { project: options.project, title: `Blog digest: ${post.title}`.slice(0, 255), description: `Source: ${post.url}\nPublished: ${post.datePublished}\n${degraded ? 'Degraded extractive fallback' : 'AI summary'}\n\n${summary}` }, key, selected!.cloud_id);
  } catch (error) {
    if (error instanceof FindingError && error.issueKey) {
      try { options.db.prepare("UPDATE digest_posts SET status = 'unknown' WHERE user_id = ? AND post_url = ? AND status = 'pending'").run(options.userId, post.url); } catch { /* Pending also blocks retry. */ }
      throw new Error(`Jira created ${error.issueKey}, but local recording failed. Do not retry.`);
    }
    if (error instanceof FindingError && error.definiteRejection) options.db.prepare("DELETE FROM digest_posts WHERE user_id = ? AND post_url = ? AND status = 'pending'").run(options.userId, post.url);
    else options.db.prepare("UPDATE digest_posts SET status = 'unknown' WHERE user_id = ? AND post_url = ? AND status = 'pending'").run(options.userId, post.url);
    if (error instanceof FindingError && error.definiteRejection) throw new Error(error.message === 'Jira site changed.' ? 'Jira site changed. No issue was created.' : 'Jira rejected the digest.');
    throw new Error('Digest Jira outcome unknown. Check Jira before retrying.');
  }
  try {
    const updated = options.db.prepare("UPDATE digest_posts SET status = 'done', issue_key = ?, issue_url = ? WHERE user_id = ? AND post_url = ? AND status = 'pending'").run(result.issueKey, result.url, options.userId, post.url);
    if (updated.changes !== 1) throw new Error('Digest reservation changed');
  } catch { throw new Error(`Jira created ${result.issueKey}, but digest recording failed. Do not retry.`); }
  return { status: 'created' as const, issueKey: result.issueKey, url: result.url, degraded };
}
