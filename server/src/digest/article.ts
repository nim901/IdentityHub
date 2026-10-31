import { parse, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
const excluded = new Set(['script', 'style', 'nav', 'aside', 'footer', 'form', 'button', 'svg', 'noscript', 'template']);
const blocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote', 'pre']);

/** Extract bounded plain text; callers must treat it as untrusted data. */
export function extractArticleText(html: string): string {
  if (Buffer.byteLength(html, 'utf8') > 1024 * 1024) throw new Error('Article too large');
  const articles: Node[] = [];
  const find = (node: Node): void => {
    if ('tagName' in node && node.tagName === 'div') {
      const classes = node.attrs.find(attr => attr.name === 'class')?.value.split(/\s+/) ?? [];
      if (classes.includes('blog-rich-text') && classes.includes('w-richtext')) articles.push(node);
    }
    if ('childNodes' in node) for (const child of node.childNodes) find(child);
  };
  find(parse(html));
  if (articles.length !== 1) throw new Error('Missing or ambiguous article body');
  const lines: string[] = [];
  let current = '';
  const flush = () => { const line = current.replace(/\s+/g, ' ').trim(); if (line) lines.push(line); current = ''; };
  const walk = (node: Node): void => {
    if ('tagName' in node && excluded.has(node.tagName)) return;
    const block = 'tagName' in node && blocks.has(node.tagName);
    if (block) flush();
    if ('value' in node && node.nodeName === '#text') current += node.value;
    if ('childNodes' in node) for (const child of node.childNodes) walk(child);
    if (block || ('tagName' in node && node.tagName === 'br')) flush();
  };
  walk(articles[0]);
  flush();
  const text = lines.join('\n');
  if (!text || text.length > 30000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw new Error('Invalid article body');
  return text;
}
