import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createCodexSummarizer } from '../src/ai/codex.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
const summarize = createCodexSummarizer({ executable: process.execPath, prefix: [fixture] });

describe('local Codex summarizer', () => {
  it('uses ChatGPT authentication, sends untrusted article text on stdin, and accepts a valid summary', async () => {
    const saved = { AI_API_KEY: process.env.AI_API_KEY, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY, CODEX_API_KEY: process.env.CODEX_API_KEY };
    try {
      process.env.AI_API_KEY = process.env.ENCRYPTION_KEY = process.env.CODEX_API_KEY = 'fake-secret';
      await expect(summarize('Article text.')).resolves.toBe('Fake Codex summary.');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  it('rejects invalid input, model output, failed execution and non-ChatGPT authentication', async () => {
    for (const article of ['', 'x'.repeat(30001), 'BAD_OUTPUT', 'PROCESS_FAIL', 'TOOL_CALL']) {
      await expect(summarize(article)).rejects.toThrow('Summarization failed');
    }
    const apiLogin = createCodexSummarizer({ executable: process.execPath, prefix: [fixture, '--api-auth'] });
    await expect(apiLogin('Article text.')).rejects.toThrow('Summarization failed');
  });
});
