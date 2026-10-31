import { createOpenAiSummarizer } from '../ai/openai.js';
import { previewLatestSummary } from './preview.js';

try {
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  if (!apiKey || !model) throw new Error('Missing configuration');
  const result = await previewLatestSummary({ fetch: globalThis.fetch, summarize: createOpenAiSummarizer({ apiKey, model, fetch: globalThis.fetch }) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write('Summary preview failed. Check configuration, blog access, and model availability.\n');
  process.exitCode = 1;
}
