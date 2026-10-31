import { expect, it } from 'vitest';
import { fetchOasisArticle } from '../src/digest/discovery.js';

it('fetches only an allowed article after a robots preflight, using an injected transport', async () => {
  const calls: string[] = [];
  const transport: typeof fetch = async (input, options) => {
    const url = String(input); calls.push(url);
    expect(options?.redirect).toBe('manual');
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow:\nSitemap: https://www.oasis.security/sitemap.xml\n');
    if (url === 'https://www.oasis.security/blog/fake') return new Response('<section class="section_header-blog"><h1>Example</h1><div class="header-blog_date"><p>Published on</p><p>Jan 2, 2025</p></div></section><div class="blog-rich-text w-richtext"><p>Safe body.</p></div>');
    throw new Error('unexpected request');
  };
  await expect(fetchOasisArticle({ url: 'https://www.oasis.security/blog/fake', title: 'Example', datePublished: '2025-01-02' }, { fetch: transport, pause: async () => {} })).resolves.toBe('Safe body.');
  expect(calls).toEqual(['https://www.oasis.security/robots.txt', 'https://www.oasis.security/blog/fake']);
});
it('rejects an unsafe URL before making requests', async () => {
  let called = false;
  await expect(fetchOasisArticle({ url: 'https://example.com/blog/fake', title: 'Example', datePublished: '2025-01-02' }, { fetch: async () => { called = true; throw new Error(); } })).rejects.toThrow();
  expect(called).toBe(false);
});

it('fails closed before fetching an article when robots restricts access', async () => {
  const calls: string[] = [];
  await expect(fetchOasisArticle({ url: 'https://www.oasis.security/blog/fake', title: 'Example', datePublished: '2025-01-02' }, { pause: async () => {}, fetch: async input => { calls.push(String(input)); return new Response('User-agent: *\nDisallow: /blog/\nSitemap: https://www.oasis.security/sitemap.xml'); } })).rejects.toThrow();
  expect(calls).toEqual(['https://www.oasis.security/robots.txt']);
});
