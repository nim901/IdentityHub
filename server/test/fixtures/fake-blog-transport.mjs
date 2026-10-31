const origin = 'https://www.oasis.security';
const page = `${origin}/blog/fake-post`;
const responses = new Map([
  [`${origin}/robots.txt`, `User-agent: *\nDisallow: ${process.env.IDENTITYHUB_FAKE_BLOCKED ? '/blog/' : ''}\nSitemap: ${origin}/sitemap.xml\n`],
  [`${origin}/sitemap.xml`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${page}</loc></url></urlset>`],
  [page, '<section class="section_header-blog"><h1>Fake post</h1><div class="header-blog_date"><p>Published on</p><p>Jan 2, 2025</p></div></section>'],
]);
globalThis.fetch = async (input, options) => {
  if (typeof input !== 'string' || !responses.has(input) || options?.method !== 'GET' || options?.redirect !== 'manual' || !options?.signal) throw new Error('Unexpected fake request');
  return new Response(responses.get(input));
};
