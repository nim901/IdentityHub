import { discoverOasis, fetchOasisArticle, MetadataCache } from './discovery.js';

type Options = { fetch: typeof fetch; pause?: (ms: number) => Promise<void>; summarize: (article: string) => Promise<string> };
export async function previewLatestSummary(options: Options) {
  const latest = await discoverOasis({ fetch: options.fetch, pause: options.pause, cache: new MetadataCache() });
  const article = await fetchOasisArticle(latest, { fetch: options.fetch, pause: options.pause });
  const summary = await options.summarize(article);
  return { ...latest, summary };
}
