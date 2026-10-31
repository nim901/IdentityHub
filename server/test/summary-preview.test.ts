import { expect, it } from 'vitest';
import { previewLatestSummary } from '../src/digest/preview.js';

it('discovers, extracts, and summarizes using fake providers without storing article text', async () => {
  const calls: string[] = [];
  const origin = 'https://www.oasis.security';
  const transport: typeof fetch = async input => {
    const url = String(input); calls.push(url);
    if (url === `${origin}/robots.txt`) return new Response(`User-agent: *\nDisallow:\nSitemap: ${origin}/sitemap.xml\n`);
    if (url === `${origin}/sitemap.xml`) return new Response(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/blog/fake</loc></url></urlset>`);
    if (url === `${origin}/blog/fake`) return new Response('<section class="section_header-blog"><h1>Example</h1><div class="header-blog_date"><p>Published on</p><p>Jan 2, 2025</p></div></section><div class="blog-rich-text w-richtext"><p>Untrusted article text.</p></div>');
    throw new Error('unexpected request');
  };
  const result = await previewLatestSummary({ fetch: transport, pause: async () => {}, summarize: async text => { expect(text).toBe('Untrusted article text.'); return 'Fake summary'; } });
  expect(result).toEqual({ url: `${origin}/blog/fake`, title: 'Example', datePublished: '2025-01-02', sameDayCount: 1, summary: 'Fake summary' });
  expect(JSON.stringify(result)).not.toContain('Untrusted article text');
  expect(calls).toHaveLength(5);
});

it('rejects changed article metadata before sending the refetched body to the model', async () => {
  const origin = 'https://www.oasis.security'; let articleRequests = 0; let summarized = false;
  const transport: typeof fetch = async input => {
    const url = String(input);
    if (url === `${origin}/robots.txt`) return new Response(`User-agent: *\nDisallow:\nSitemap: ${origin}/sitemap.xml\n`);
    if (url === `${origin}/sitemap.xml`) return new Response(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/blog/fake</loc></url></urlset>`);
    if (url === `${origin}/blog/fake`) {
      articleRequests++;
      const title = articleRequests === 1 ? 'Original' : 'Changed';
      return new Response(`<section class="section_header-blog"><h1>${title}</h1><div class="header-blog_date"><p>Published on</p><p>Jan 2, 2025</p></div></section><div class="blog-rich-text w-richtext"><p>Body.</p></div>`);
    }
    throw new Error('unexpected fake request');
  };
  await expect(previewLatestSummary({ fetch: transport, pause: async () => {}, summarize: async () => { summarized = true; return 'summary'; } })).rejects.toThrow();
  expect(summarized).toBe(false);
});

it('rejects a changed publication date before summarization', async () => {
  const origin = 'https://www.oasis.security'; let articleRequests = 0; let summarized = false;
  const transport: typeof fetch = async input => {
    const url = String(input);
    if (url === `${origin}/robots.txt`) return new Response(`User-agent: *\nDisallow:\nSitemap: ${origin}/sitemap.xml\n`);
    if (url === `${origin}/sitemap.xml`) return new Response(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/blog/fake</loc></url></urlset>`);
    if (url === `${origin}/blog/fake`) {
      articleRequests++;
      const day = articleRequests === 1 ? 2 : 3;
      return new Response(`<section class="section_header-blog"><h1>Original</h1><div class="header-blog_date"><p>Published on</p><p>Jan ${day}, 2025</p></div></section><div class="blog-rich-text w-richtext"><p>Body.</p></div>`);
    }
    throw new Error('unexpected fake request');
  };
  await expect(previewLatestSummary({ fetch: transport, pause: async () => {}, summarize: async () => { summarized = true; return 'summary'; } })).rejects.toThrow();
  expect(summarized).toBe(false);
});
