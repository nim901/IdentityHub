import { SaxesParser } from 'saxes';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

// Sitemap XML: https://www.sitemaps.org/protocol.html
// Oasis's public sitemap is advertised at https://www.oasis.security/robots.txt.
// The visible date and heading structure was inspected at https://www.oasis.security/blog/5-ways-non-human-identity-ownership-impacts-your-security-program.
const ORIGIN = 'https://www.oasis.security';
export const OASIS_SITEMAP_URL = `${ORIGIN}/sitemap.xml`;
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const MAX_BYTES = 1024 * 1024;
const MAX_SITEMAPS = 8;
const MAX_POSTS = 250;
const MAX_ENTRIES = 5000;
const CACHE_TTL = 60 * 60 * 1000;
let requestTail: Promise<void> = Promise.resolve();
let previousRequest = false;
let timedOut = false;
export type PostMetadata = { url: string; title: string; datePublished: string };
export type DiscoveryResult = PostMetadata & { sameDayCount: number };
type CachedPost = { lastmod: string; fetchedAt: number; post: PostMetadata };
export class MetadataCache {
  private readonly entries = new Map<string, CachedPost>();
  get(url: string, lastmod: string | undefined, now: number): PostMetadata | undefined {
    const entry = this.entries.get(url);
    return entry && lastmod && entry.lastmod === lastmod && now >= entry.fetchedAt && now - entry.fetchedAt < CACHE_TTL && validCachedPost(url, entry.post) ? { ...entry.post } : undefined;
  }
  set(url: string, lastmod: string | undefined, now: number, post: PostMetadata) {
    if (lastmod && lastmod.length <= 128 && Number.isFinite(now) && validCachedPost(url, post)) {
      if (!this.entries.has(url) && this.entries.size >= MAX_POSTS) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(url, { lastmod, fetchedAt: now, post: { ...post } });
    }
  }
}
type Options = { sitemapUrl: string; fetch: typeof fetch; cache?: MetadataCache; pause?: (ms: number) => Promise<void>; now?: () => number; checkRobots?: boolean };
type Entry = { url: string; lastmod?: string };

function checkRobots(text: string) {
  let wildcard = false, advertised = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) throw new Error('Invalid robots.txt');
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!['user-agent', 'sitemap', 'allow', 'disallow', 'crawl-delay'].includes(name)) throw new Error('Unsupported robots directive');
    if (name === 'user-agent' && value === '*') wildcard = true;
    if (name === 'sitemap' && value === OASIS_SITEMAP_URL) advertised = true;
    // Conservatively stop for restrictions in any group; do not guess group precedence.
    if ((name === 'disallow' && value) || (name === 'crawl-delay' && value && value !== '0')) throw new Error('Robots policy requires review');
  }
  if (!wildcard || !advertised) throw new Error('Robots policy or sitemap requires review');
}

function safeUrl(raw: string, kind: 'sitemap' | 'post'): string {
  if (raw.length > 2048 || /[\u0000-\u0020\\%]/.test(raw)) throw new Error('Unsafe URL');
  const url = new URL(raw);
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || url.port) throw new Error('Unsafe URL');
  if (kind === 'post' && !/^\/blog\/[A-Za-z0-9][A-Za-z0-9_-]*\/?$/.test(url.pathname)) throw new Error('Unsafe post URL');
  if (kind === 'sitemap' && !/^\/[A-Za-z0-9_./-]+\.xml$/.test(url.pathname)) throw new Error('Unsafe sitemap URL');
  return url.href;
}

function validCachedPost(url: string, post: PostMetadata): boolean {
  try {
    if (safeUrl(url, 'post') !== url || !post || post.url !== url || typeof post.title !== 'string' ||
        !post.title.trim() || post.title !== post.title.trim() || post.title.length > 255 || /[\u0000-\u001f\u007f-\u009f]/.test(post.title) ||
        typeof post.datePublished !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(post.datePublished)) return false;
    const [year, month, day] = post.datePublished.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  } catch { return false; }
}

function sitemap(xml: string): { kind: 'urlset' | 'sitemapindex'; entries: Entry[] } {
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = [];
  const entries: Entry[] = [];
  let root: 'urlset' | 'sitemapindex' | undefined;
  let current: { url?: string; lastmod?: string } | undefined;
  let text = '';
  parser.on('doctype', () => { throw new Error('DTD not allowed'); });
  parser.on('opentag', tag => {
    stack.push(tag.local);
    if (stack.length === 1) {
      if (tag.uri !== NS || (tag.local !== 'urlset' && tag.local !== 'sitemapindex')) throw new Error('Invalid sitemap root');
      root = tag.local;
    }
    if (stack.length === 2 && tag.uri === NS && tag.local === (root === 'urlset' ? 'url' : 'sitemap')) current = {};
    if (current && stack.length === 3 && tag.uri === NS && (tag.local === 'loc' || tag.local === 'lastmod')) text = '';
  });
  parser.on('text', value => { if (current && stack.length === 3 && ['loc', 'lastmod'].includes(stack[2])) text += value; });
  parser.on('closetag', tag => {
    if (current && stack.length === 3 && tag.uri === NS && tag.local === 'loc') {
      if (current.url !== undefined) throw new Error('Duplicate sitemap location');
      current.url = text.trim();
    }
    if (current && stack.length === 3 && tag.uri === NS && tag.local === 'lastmod') {
      if (text.length > 128 || current.lastmod !== undefined) throw new Error('Invalid sitemap modification date');
      current.lastmod = text.trim();
    }
    if (current && stack.length === 2 && tag.uri === NS && tag.local === (root === 'urlset' ? 'url' : 'sitemap')) {
      if (!current.url) throw new Error('Missing sitemap location');
      entries.push({ url: current.url, lastmod: current.lastmod });
      if (entries.length > MAX_ENTRIES) throw new Error('Sitemap entry limit exceeded');
      current = undefined;
    }
    stack.pop();
  });
  parser.write(xml).close();
  if (!root) throw new Error('Invalid sitemap');
  return { kind: root, entries };
}

function publishedDate(value: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/.exec(value);
  if (!match) throw new Error('Invalid article publication date');
  const month = months.indexOf(match[1]) + 1, day = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Invalid article publication date');
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function article(html: string, url: string): PostMetadata {
  const document = parse(html);
  const titles: string[] = [];
  const dates: string[] = [];
  type Node = DefaultTreeAdapterMap['node'];
  const headers: Node[] = [];
  const findHeaders = (node: Node) => {
    if ('tagName' in node && node.tagName === 'section' && node.attrs.some(attr => attr.name === 'class' && attr.value.split(/\s+/).includes('section_header-blog'))) headers.push(node);
    if ('childNodes' in node) for (const child of node.childNodes) findHeaders(child);
  };
  findHeaders(document);
  if (headers.length !== 1) throw new Error('Missing or ambiguous article header');
  const content = (node: Node): string => {
    if ('value' in node && node.nodeName === '#text') return node.value;
    return 'childNodes' in node ? node.childNodes.map(content).join('') : '';
  };
  const visit = (node: Node) => {
    if ('tagName' in node && node.tagName === 'h1') titles.push(content(node).trim().replace(/\s+/g, ' '));
    if ('tagName' in node && node.tagName === 'div' && node.attrs.some(attr => attr.name === 'class' && attr.value.split(/\s+/).includes('header-blog_date'))) {
      const fields = node.childNodes.filter(child => 'tagName' in child && child.tagName === 'p').map(child => content(child).trim().replace(/\s+/g, ' '));
      if (fields[0] === 'Published on') {
        if (fields.length !== 2) throw new Error('Ambiguous article publication date');
        dates.push(publishedDate(fields[1]));
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  visit(headers[0]);
  if (titles.length !== 1 || !titles[0] || titles[0].length > 255 || /[\u0000-\u001f\u007f-\u009f]/.test(titles[0]) || dates.length !== 1) throw new Error('Missing or ambiguous article metadata');
  return { url, title: titles[0], datePublished: dates[0] };
}

async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('Request timed out');
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new Error('Response too large');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export async function discoverLatest(options: Options): Promise<DiscoveryResult> {
  const pause = options.pause ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const queue = [safeUrl(options.sitemapUrl, 'sitemap')];
  const visited = new Set<string>();
  const posts = new Map<string, string | undefined>();
  const get = async (url: string) => {
    const previous = requestTail;
    let release!: () => void;
    requestTail = new Promise<void>(resolve => { release = resolve; });
    try {
      await previous;
      if (timedOut) throw new Error('Discovery disabled after a timeout; restart before retrying');
      if (previousRequest) await pause(500);
      previousRequest = true;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Request timed out')); }, 10000); });
      try {
        return await Promise.race([(async () => {
          const response = await options.fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
          if (!response.ok || response.redirected || (response.url && response.url !== url)) {
            await response.body?.cancel();
            throw new Error('Discovery request failed');
          }
          return readBounded(response, controller.signal);
        })(), timeout]);
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
    } finally { release(); }
  };
  if (options.checkRobots) checkRobots(await get(`${ORIGIN}/robots.txt`));
  while (queue.length) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    if (visited.size >= MAX_SITEMAPS) throw new Error('Sitemap limit exceeded');
    visited.add(url);
    const result = sitemap(await get(url));
    for (const entry of result.entries) {
      if (result.kind === 'sitemapindex') { queue.push(safeUrl(entry.url, 'sitemap')); continue; }
      let candidate: URL;
      try { candidate = new URL(entry.url); } catch { throw new Error('Invalid sitemap URL'); }
      // Variants of the allowed host and encoded paths can conceal blog URLs from the scope filter.
      const hostname = candidate.hostname.replace(/\.$/, '');
      if (['www.oasis.security', 'oasis.security'].includes(hostname) &&
          (candidate.origin !== ORIGIN || candidate.username || candidate.password || candidate.pathname.includes('%'))) throw new Error('Unsupported sitemap URL');
      if (candidate.origin !== ORIGIN || !candidate.pathname.startsWith('/blog/')) continue;
      const post = safeUrl(entry.url, 'post');
      if (posts.has(post) && posts.get(post) !== entry.lastmod) throw new Error('Conflicting sitemap entry');
      posts.set(post, entry.lastmod);
      if (posts.size > MAX_POSTS) throw new Error('Post limit exceeded');
    }
  }
  if (!posts.size) throw new Error('No blog posts found');
  const results: PostMetadata[] = [];
  for (const [url, lastmod] of posts) {
    const cached = options.cache?.get(url, lastmod, now());
    const post = cached ?? article(await get(url), url);
    if (!cached) options.cache?.set(url, lastmod, now(), post);
    results.push(post);
  }
  results.sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return { ...results[0], sameDayCount: results.filter(post => post.datePublished === results[0].datePublished).length };
}

export function discoverOasis(options: Omit<Options, 'sitemapUrl' | 'checkRobots'>): Promise<DiscoveryResult> {
  return discoverLatest({ ...options, sitemapUrl: OASIS_SITEMAP_URL, checkRobots: true });
}
