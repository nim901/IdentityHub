if (process.env.IDENTITYHUB_FAKE_PRIVATE_SENTINEL) throw new Error('Unexpected inherited private environment');
const origin = 'https://www.oasis.security';
const page = `${origin}/blog/fake-post`;
globalThis.fetch = async (input, options) => {
  if (input === 'https://api.openai.com/v1/responses' && options?.method === 'POST' && options?.redirect === 'error' && options?.headers?.Authorization === 'Bearer fake-key') {
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A fake summary.' }] }] }));
  }
  if (options?.method !== 'GET' || options?.redirect !== 'manual' || !options?.signal) throw new Error('Unexpected fake request');
  if (input === `${origin}/robots.txt`) return new Response(`User-agent: *\nDisallow:\nSitemap: ${origin}/sitemap.xml\n`);
  if (input === `${origin}/sitemap.xml`) return new Response(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${page}</loc></url></urlset>`);
  if (input === page) return new Response('<section class="section_header-blog"><h1>Fake post</h1><div class="header-blog_date"><p>Published on</p><p>Jan 2, 2025</p></div></section><div class="blog-rich-text w-richtext"><p>Fake article.</p></div>');
  throw new Error('Unexpected fake request');
};
