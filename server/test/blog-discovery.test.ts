import { expect, it, vi } from 'vitest';
import { discoverLatest, discoverOasis, MetadataCache, OASIS_SITEMAP_URL } from '../src/digest/discovery.js';

const root = 'https://www.oasis.security/test-sitemap.xml';
const post = 'https://www.oasis.security/blog/example';
const xml = (lastmod = '2026-01-01') => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${post}</loc><lastmod>${lastmod}</lastmod></url></urlset>`;
const html = (date = '2025-01-01') => {
  const match = /^(\d{4})-(\d\d)-(\d\d)$/.exec(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const visible = match ? `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : date;
  return `<section class="section_header-blog"><h1>Example</h1><div class="header-blog_date"><p>Published on</p><p>${visible}</p></div></section>`;
};

it('uses the visible publication date and heading when JSON-LD was restamped', async () => {
  const page = `<section class="section_header-blog"><h1>Actual article title</h1><div class="header-blog_date"><p>Published on</p><p>Oct 23, 2024</p></div><div class="header-blog_date"><p>Updated</p><p>May 1, 2026</p></div></section><article><h1>Unrelated body heading</h1></article><script type="application/ld+json">{"@type":"BlogPosting","headline":"Different SEO title","datePublished":"2026-05-01"}</script>`;
  const transport: typeof fetch = async input => new Response(String(input) === root ? xml('2026-05-01') : page);
  await expect(discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).resolves.toMatchObject({ title: 'Actual article title', datePublished: '2024-10-23' });
});

it('selects the newest publication date, not sitemap order or last modification', async () => {
  const pages: Record<string, string> = {
    'https://www.oasis.security/sitemap-test.xml': '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.oasis.security/blog/older</loc><lastmod>2026-10-30</lastmod></url><url><loc>https://www.oasis.security/blog/newer</loc><lastmod>2026-01-01</lastmod></url></urlset>',
    'https://www.oasis.security/blog/older': html('2025-01-01').replace('Example', 'Old'),
    'https://www.oasis.security/blog/newer': html('2026-01-01').replace('Example', 'New'),
  };
  const calls: string[] = [];
  const transport: typeof fetch = async input => {
    const url = String(input); calls.push(url);
    if (!(url in pages)) throw new Error('Unexpected network request');
    return new Response(pages[url], { status: 200 });
  };
  const result = await discoverLatest({ sitemapUrl: Object.keys(pages)[0], fetch: transport, pause: async () => {} });
  expect(result).toMatchObject({ url: 'https://www.oasis.security/blog/newer', title: 'New', datePublished: '2026-01-01' });
  expect(calls).toHaveLength(3);
});

it('breaks same-day ties by URL without claiming a publication time', async () => {
  const other = 'https://www.oasis.security/blog/another';
  const listing = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${post}</loc></url><url><loc>${other}</loc></url></urlset>`;
  const transport: typeof fetch = async input => new Response(String(input) === root ? listing : html('2026-08-05'));
  expect(await discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).toMatchObject({ url: other, datePublished: '2026-08-05', sameDayCount: 2 });
});

it('reuses only fresh metadata with an unchanged lastmod and refetches when restamped', async () => {
  const cache = new MetadataCache();
  let lastmod = '2026-01-01'; let date = '2025-01-01'; let time = 1000; const calls: string[] = [];
  const transport: typeof fetch = async input => { const url = String(input); calls.push(url); return new Response(url === root ? xml(lastmod) : `${html(date)}<article>private article body</article>`); };
  const options = { sitemapUrl: root, fetch: transport, cache, pause: async () => {}, now: () => time };
  await discoverLatest(options);
  await discoverLatest(options);
  expect(calls.filter(url => url === post)).toHaveLength(1);
  const stored = (cache as unknown as { entries: Map<string, unknown> }).entries;
  expect(JSON.stringify([...stored.values()])).not.toContain('<h1');
  expect(JSON.stringify([...stored.values()])).not.toContain('private article body');
  lastmod = '2026-02-01'; date = '2024-01-01';
  expect((await discoverLatest(options)).datePublished).toBe('2024-01-01');
  time += 3600001;
  await discoverLatest(options);
  expect(calls.filter(url => url === post)).toHaveLength(3);
  lastmod = '';
  await discoverLatest(options);
  await discoverLatest(options);
  expect(calls.filter(url => url === post)).toHaveLength(5);
});

it('does not return a poisoned cache entry with an unrelated URL or invalid date', async () => {
  for (const poisoned of [
    { url: 'https://attacker.example/blog/fake', title: 'Poisoned', datePublished: '2099-01-01' },
    { url: post, title: 'Poisoned', datePublished: 'not-a-date' },
    { url: post, title: 'Poisoned', datePublished: '2026-02-30' },
    { url: post, title: 'Bad\u001btitle', datePublished: '2025-01-01' },
  ]) {
    const cache = new MetadataCache();
    try { cache.set(post, '2026-01-01', 1000, poisoned); } catch { /* Rejection is also safe. */ }
    const calls: string[] = [];
    const transport: typeof fetch = async input => { calls.push(String(input)); return new Response(String(input) === root ? xml() : html()); };
    const result = await discoverLatest({ sitemapUrl: root, fetch: transport, cache, pause: async () => {}, now: () => 1000 });
    expect(result).toMatchObject({ url: post, title: 'Example', datePublished: '2025-01-01' });
    expect(calls).toContain(post);
  }
  const cache = new MetadataCache();
  cache.set(post, '2026-01-01', 1000, { url: post, title: 'Example', datePublished: '2025-01-01' });
  const entries = (cache as unknown as { entries: Map<string, { post: { url: string } }> }).entries;
  entries.get(post)!.post.url = 'https://attacker.example/blog/fake';
  const calls: string[] = [];
  const transport: typeof fetch = async input => { calls.push(String(input)); return new Response(String(input) === root ? xml() : html()); };
  expect(await discoverLatest({ sitemapUrl: root, fetch: transport, cache, pause: async () => {}, now: () => 1000 })).toMatchObject({ url: post, datePublished: '2025-01-01' });
  expect(calls).toContain(post);
});

it('never follows offsite sitemap links or redirects', async () => {
  const calls: string[] = [];
  const transport: typeof fetch = async input => { calls.push(String(input)); return new Response('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://attacker.example/sitemap.xml</loc></sitemap></sitemapindex>'); };
  await expect(discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).rejects.toThrow();
  expect(calls).toEqual([root]);
  await expect(discoverLatest({ sitemapUrl: 'http://www.oasis.security/test.xml', fetch: transport })).rejects.toThrow();
  await expect(discoverLatest({ sitemapUrl: 'https://www.oasis.security@attacker.example/test.xml', fetch: transport })).rejects.toThrow();
  const redirect: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } });
  await expect(discoverLatest({ sitemapUrl: root, fetch: redirect, pause: async () => {} })).rejects.toThrow();
});

it('traverses a sitemap index without treating lastmod as publication date', async () => {
  const child = 'https://www.oasis.security/child.xml';
  const index = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${child}</loc></sitemap></sitemapindex>`;
  const requested: string[] = [];
  const transport: typeof fetch = async input => {
    const url = String(input); requested.push(url);
    if (url === root) return new Response(index);
    if (url === child) return new Response(xml('2026-10-01'));
    if (url === post) return new Response(html('2024-01-01'));
    throw new Error('Unexpected network request');
  };
  expect((await discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).datePublished).toBe('2024-01-01');
  expect(requested).toEqual([root, child, post]);
});

it('does not fetch hostile blog links and refuses to return a partial result on crawl failure', async () => {
  const other = 'https://www.oasis.security/blog/second';
  const listing = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${post}</loc></url><url><loc>${other}</loc></url><url><loc>https://attacker.example/blog/trap</loc></url></urlset>`;
  const calls: string[] = [];
  const transport: typeof fetch = async input => {
    const url = String(input); calls.push(url);
    if (url === root) return new Response(listing);
    if (url === post) return new Response(html());
    if (url === other) return new Response('private fake error', { status: 503 });
    throw new Error('Unexpected network request');
  };
  await expect(discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).rejects.toThrow('Discovery request failed');
  expect(calls).toEqual([root, post, other]);
});

it('does not silently skip encoded same-origin paths that could hide blog posts', async () => {
  const listing = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${post}</loc></url><url><loc>https://www.oasis.security/%62log/hidden</loc></url></urlset>`;
  const transport: typeof fetch = async input => new Response(String(input) === root ? listing : html());
  await expect(discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).rejects.toThrow();
});

it('fails if the sitemap uses an insecure URL for the allowed blog host', async () => {
  const listing = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${post}</loc></url><url><loc>http://www.oasis.security/blog/hidden</loc></url></urlset>`;
  const transport: typeof fetch = async input => new Response(String(input) === root ? listing : html());
  await expect(discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).rejects.toThrow();
});

it('rejects DTDs, malformed XML, oversized bodies and malformed publication dates', async () => {
  for (const source of ['<!DOCTYPE urlset [<!ENTITY x SYSTEM "http://127.0.0.1/">]><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>', '<urlset>', 'x'.repeat(1048577)]) {
    await expect(discoverLatest({ sitemapUrl: root, fetch: async () => new Response(source), pause: async () => {} })).rejects.toThrow();
  }
  for (const date of ['2026-02-30', 'not-a-date', '2026-01-01T10:00:00']) {
    await expect(discoverLatest({ sitemapUrl: root, fetch: async input => new Response(String(input) === root ? xml() : html(date)), pause: async () => {} })).rejects.toThrow();
  }
});

it('fails rather than selecting an incomplete or ambiguous set of posts', async () => {
  for (const body of ['<html>no metadata</html>', html() + html('2026-01-01'), '<h1>Title</h1><div class="header-blog_date"><p>Updated</p><p>Jan 1, 2025</p></div>']) {
    await expect(discoverLatest({ sitemapUrl: root, fetch: async input => new Response(String(input) === root ? xml() : body), pause: async () => {} })).rejects.toThrow();
  }
  const many = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: 251 }, (_, i) => `<url><loc>https://www.oasis.security/blog/post-${i}</loc></url>`).join('')}</urlset>`;
  await expect(discoverLatest({ sitemapUrl: root, fetch: async () => new Response(many), pause: async () => {} })).rejects.toThrow();
});

it('uses the verified sitemap URL with a fake transport', async () => {
  const calls: string[] = [];
  const robots = 'https://www.oasis.security/robots.txt';
  const transport: typeof fetch = async input => { const url = String(input); calls.push(url); return new Response(url === robots ? `User-agent: *\nDisallow:\nSitemap: ${OASIS_SITEMAP_URL}\n` : url === OASIS_SITEMAP_URL ? xml() : html()); };
  await expect(discoverOasis({ fetch: transport, pause: async () => {} })).resolves.toMatchObject({ url: post });
  expect(calls).toEqual([robots, OASIS_SITEMAP_URL, post]);
});

it('fails before crawling if robots.txt restricts access or changes the sitemap', async () => {
  for (const body of [`User-agent: *\nDisallow: /blog/\nSitemap: ${OASIS_SITEMAP_URL}\n`, 'User-agent: *\nDisallow:\nSitemap: https://www.oasis.security/other.xml\n', `User-agent: *\nDisallow:\nCrawl-delay: 5\nSitemap: ${OASIS_SITEMAP_URL}\n`, `User-agent: other\nDisallow:\nSitemap: ${OASIS_SITEMAP_URL}\n`, `User-agent: *\nDisallow:\nUser-agent: other\nDisallow: /private\nSitemap: ${OASIS_SITEMAP_URL}\n`, `User-agent: *\nDisallow:\nRequest-rate: 1/60\nSitemap: ${OASIS_SITEMAP_URL}\n`]) {
    const calls: string[] = [];
    const transport: typeof fetch = async input => { calls.push(String(input)); return new Response(body); };
    await expect(discoverOasis({ fetch: transport, pause: async () => {} })).rejects.toThrow();
    expect(calls).toEqual(['https://www.oasis.security/robots.txt']);
  }
});

it('accepts a sitemap with more than 258 total entries while bounding blog candidates', async () => {
  const entries = Array.from({ length: 262 }, (_, i) => `<url><loc>https://www.oasis.security/pages/page-${i}</loc></url>`).join('');
  const listing = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}<url><loc>${post}</loc></url></urlset>`;
  const transport: typeof fetch = async input => new Response(String(input) === root ? listing : html());
  await expect(discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).resolves.toMatchObject({ url: post });
});

it('rejects sitemaps above the total entry limit', async () => {
  const entries = Array.from({ length: 5001 }, (_, i) => `<url><loc>https://www.oasis.security/pages/page-${i}</loc></url>`).join('');
  const listing = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  await expect(discoverLatest({ sitemapUrl: root, fetch: async () => new Response(listing), pause: async () => {} })).rejects.toThrow('Sitemap entry limit exceeded');
});

it('serializes and spaces requests even across concurrent discoveries', async () => {
  let active = 0; let maxActive = 0; let pauses = 0;
  const transport: typeof fetch = async input => {
    active++; maxActive = Math.max(active, maxActive);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return new Response(String(input) === root ? xml() : html());
  };
  const pause = async (ms: number) => { expect(ms).toBeGreaterThanOrEqual(500); pauses++; };
  await Promise.all([discoverLatest({ sitemapUrl: root, fetch: transport, pause }), discoverLatest({ sitemapUrl: root, fetch: transport, pause })]);
  expect(maxActive).toBe(1);
  expect(pauses).toBeGreaterThanOrEqual(3);
});

it('keeps requests serialized until each response body has finished streaming', async () => {
  let active = 0, maxActive = 0;
  const transport: typeof fetch = async input => {
    const body = String(input) === root ? xml() : html();
    active++; maxActive = Math.max(maxActive, active);
    return new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => { controller.enqueue(new TextEncoder().encode(body)); controller.close(); active--; }, 5);
      },
    }));
  };
  const options = { sitemapUrl: root, fetch: transport, pause: async () => {} };
  await Promise.all([discoverLatest(options), discoverLatest(options)]);
  expect(maxActive).toBe(1);
});

it('uses at least 500 ms between requests with the default scheduler', async () => {
  vi.useFakeTimers();
  try {
    const times: number[] = [];
    const transport: typeof fetch = async input => { times.push(Date.now()); return new Response(String(input) === root ? xml() : html()); };
    const result = discoverLatest({ sitemapUrl: root, fetch: transport });
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(500);
  } finally { vi.useRealTimers(); }
});

it('times out and refuses further requests if an injected transport ignores abort', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return new Promise<Response>(() => {}); };
  try {
    const pending = discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} });
    const failure = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10000);
    await failure;
    const secondFailure = expect(discoverLatest({ sitemapUrl: root, fetch: transport, pause: async () => {} })).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10000);
    await secondFailure;
    expect(calls).toBe(1);
  } finally { vi.useRealTimers(); }
});
