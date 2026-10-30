import { createFakeAtlassian } from './service.js';

const callback = process.env.OAUTH_REDIRECT_URI ?? 'http://localhost:3000/api/jira/callback';
const app = createFakeAtlassian(callback);
try {
  await app.listen({ host: '127.0.0.1', port: 4010 });
  console.log('Fake Atlassian listening on http://127.0.0.1:4010');
} catch {
  console.error('Could not start fake Atlassian service');
  process.exitCode = 1;
}
