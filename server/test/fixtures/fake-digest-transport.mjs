import { appendFileSync } from 'node:fs';
const origin = 'https://www.oasis.security';
const post = `${origin}/blog/fake`;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.href === `${origin}/robots.txt`) return new Response(`User-agent: *\nDisallow:\nSitemap: ${origin}/sitemap.xml\n`);
  if (url.href === `${origin}/sitemap.xml`) return new Response(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${post}</loc></url></urlset>`);
  if (url.href === post) return new Response('<section class="section_header-blog"><h1>Fake post</h1><div class="header-blog_date"><p>Published on</p><p>Jan 2, 2025</p></div></section><div class="blog-rich-text w-richtext"><p>Fake article content.</p></div>');
  if (url.href === 'https://api.openai.com/v1/responses' && options.method === 'POST') return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fake summary.' }] }] });
  if (url.href === 'https://api.atlassian.com/oauth/token/accessible-resources') return Response.json([{ id: 'site-one', name: 'One', url: 'https://one.atlassian.net', scopes: ['read:jira-work', 'write:jira-work'] }]);
  const path = url.pathname.replace('/ex/jira/site-one', '');
  if (url.origin === 'https://api.atlassian.com' && path === '/rest/api/3/project/search') return Response.json({ startAt: 0, isLast: true, values: [{ id: '100', key: 'ONE', name: 'Project' }] });
  if (url.origin === 'https://api.atlassian.com' && path === '/rest/api/3/issue/createmeta/ONE/issuetypes') return Response.json({ startAt: 0, total: 1, issueTypes: [{ id: '1', name: 'Task', subtask: false }] });
  if (url.origin === 'https://api.atlassian.com' && path === '/rest/api/3/issue/createmeta/ONE/issuetypes/1') return Response.json({ startAt: 0, total: 2, fields: [{ fieldId: 'summary', operations: ['set'], required: true }, { fieldId: 'description', operations: ['set'], required: false }] });
  if (url.origin === 'https://api.atlassian.com' && path === '/rest/api/3/issue' && options.method === 'POST') {
    if (!process.env.FAKE_PROVIDER_LOG) throw new Error('Missing fake write log');
    appendFileSync(process.env.FAKE_PROVIDER_LOG, 'write\n');
  }
  if (url.origin === 'https://api.atlassian.com' && path === '/rest/api/3/issue' && options.method === 'POST' && process.env.FAKE_JIRA_FAIL) return new Response('fake upstream failure', { status: 503 });
  if (url.origin === 'https://api.atlassian.com' && path === '/rest/api/3/issue' && options.method === 'POST') return Response.json({ id: '1001', key: 'ONE-1', self: 'https://api.atlassian.com/ex/jira/site-one/rest/api/3/issue/1001' }, { status: 201 });
  throw new Error('Unexpected fake provider request');
};
