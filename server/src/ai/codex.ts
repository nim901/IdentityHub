// Codex exec, JSON events, sandbox and authentication: https://developers.openai.com/codex/noninteractive
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { instructions, validateArticle, validateSummary } from './openai.js';

type Options = { executable?: string; prefix?: string[] };

function run(executable: string, args: string[], cwd: string, input = '', captureStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    const child = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0, failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); }, 60000);
    const collect = (chunk: Buffer) => { size += chunk.length; if (size > 65536) { failed = true; child.kill(); } else chunks.push(chunk); };
    child.stdout.on('data', collect);
    if (captureStderr) child.stderr.on('data', collect); else child.stderr.resume();
    child.stdin.on('error', () => { failed = true; });
    child.on('error', () => { failed = true; });
    child.on('close', code => {
      clearTimeout(timer);
      if (failed || code !== 0) reject(new Error('Summarization failed'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(input);
  });
}

export function createCodexSummarizer(options: Options = {}): (article: string) => Promise<string> {
  return async article => {
    validateArticle(article);
    const dir = await mkdtemp(join(tmpdir(), 'identityhub-codex-'));
    const executable = options.executable ?? 'codex';
    const prefix = options.prefix ?? [];
    try {
      const status = await run(executable, [...prefix, 'login', 'status'], dir, '', true);
      if (!/^Logged in using ChatGPT\s*$/.test(status)) throw new Error();
      const output = await run(executable, [...prefix, 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-'], dir, `${instructions}\n\nArticle:\n${article}`);
      let summary = '', completed = false;
      for (const line of output.split('\n').filter(Boolean)) {
        const event: unknown = JSON.parse(line);
        if (!event || typeof event !== 'object' || !('type' in event)) throw new Error();
        const e = event as { type: string; item?: { type?: string; text?: string } };
        if (e.type === 'turn.failed' || e.type === 'error') throw new Error();
        if (e.item && !['agent_message', 'reasoning'].includes(e.item.type ?? '')) throw new Error();
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') {
          if (typeof e.item.text !== 'string') throw new Error();
          summary = e.item.text;
        }
        if (e.type === 'turn.completed') completed = true;
      }
      if (!completed) throw new Error();
      return validateSummary(summary);
    } catch { throw new Error('Summarization failed'); }
    finally { await rm(dir, { recursive: true, force: true }); }
  };
}
