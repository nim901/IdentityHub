const args = process.argv.slice(2);
const apiAuth = args[0] === '--api-auth';
if (apiAuth) args.shift();
if (args[0] === 'login') {
  process.stderr.write(apiAuth ? 'Logged in using an API key\n' : 'Logged in using ChatGPT\n');
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (!args.includes('--ephemeral') || !args.includes('--ignore-user-config') || !args.includes('read-only') || !input.includes('untrusted') || process.env.AI_API_KEY || process.env.ENCRYPTION_KEY || process.env.CODEX_API_KEY) process.exit(2);
  if (input.includes('PROCESS_FAIL')) process.exit(1);
  if (input.includes('TOOL_CALL')) process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: input.includes('BAD_OUTPUT') ? 'x'.repeat(5001) : 'Fake Codex summary.' } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\n');
}
