import { discoverOasis, MetadataCache } from './discovery.js';

try {
  const latest = await discoverOasis({ fetch: globalThis.fetch, cache: new MetadataCache() });
  process.stdout.write(`${JSON.stringify(latest)}\n`);
} catch {
  process.stderr.write('Blog discovery failed. Check the sitemap, article metadata, and network connection.\n');
  process.exitCode = 1;
}
