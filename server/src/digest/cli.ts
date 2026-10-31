import { existsSync } from 'node:fs';
import { openDatabase } from '../db/database.js';
import { JiraOAuth } from '../jira/oauth.js';
import { JiraConnection } from '../jira/connection.js';
import { FindingsService } from '../jira/findings.js';
import { createOpenAiSummarizer } from '../ai/openai.js';
import { discoverOasis, fetchOasisArticle, MetadataCache } from './discovery.js';
import { runDigest } from './command.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--dry-run', '--require-ai'].includes(arg)) || new Set(args).size !== args.length) throw new Error('Invalid arguments');
  const dryRun = args.includes('--dry-run'), requireAi = args.includes('--require-ai');
  const email = process.env.DIGEST_USER_EMAIL, project = process.env.DIGEST_PROJECT_KEY;
  const path = process.env.DATABASE_PATH ?? 'app.db';
  if (!email || !project || !existsSync(path)) throw new Error('Missing digest configuration or database');
  const db = openDatabase(path);
  try {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error('Digest user not found');
    let summarize: ((text: string) => Promise<string>) | undefined;
    if (process.env.AI_API_KEY && process.env.AI_MODEL) {
      try { summarize = createOpenAiSummarizer({ apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL, fetch: globalThis.fetch }); } catch { /* Treated as unavailable below. */ }
    }
    if (requireAi && !summarize) throw new Error('AI summary unavailable');
    let findings: FindingsService | undefined;
    if (!dryRun) {
      const { ATLASSIAN_CLIENT_ID: clientId, ATLASSIAN_CLIENT_SECRET: clientSecret, OAUTH_REDIRECT_URI: redirectUri, ENCRYPTION_KEY: encryptionKey, ATLASSIAN_AUTH_BASE: authBase, ATLASSIAN_AUTH_BROWSER_BASE: browserBase, JIRA_DEFAULT_ISSUE_TYPE: defaultType } = process.env;
      if (!clientId || !clientSecret || !redirectUri || !encryptionKey || (authBase && authBase !== 'https://auth.atlassian.com') || (browserBase && browserBase !== 'https://auth.atlassian.com')) throw new Error('Jira connection is not configured');
      findings = new FindingsService(db, new JiraConnection(db, new JiraOAuth(db, { clientId, clientSecret, redirectUri, encryptionKey })), defaultType && defaultType.length <= 255 ? defaultType : undefined);
    }
    const result = await runDigest({ db, userId: user.id, project, dryRun, requireAi, summarize,
      read: async () => { const post = await discoverOasis({ fetch: globalThis.fetch, cache: new MetadataCache() }); const text = await fetchOasisArticle(post, { fetch: globalThis.fetch }); return { ...post, text }; },
      create: (actor, input, key, siteId) => { if (!findings) throw new Error('Jira is unavailable'); return findings.create(actor, input, key, siteId); },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if ('degraded' in result && result.degraded) process.exitCode = 3;
  } finally { db.close(); }
}

main().catch(error => {
  const message = error instanceof Error && /^(?:Earlier digest outcome unresolved|Digest Jira outcome unknown|Jira created [A-Z][A-Z0-9_]{0,31}-[1-9][0-9]{0,19}, but (?:local|digest) recording failed|Jira rejected the digest|Jira site changed\. No issue was created|AI summary unavailable)/.test(error.message) ? error.message : 'Digest failed. Check configuration and provider availability.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
