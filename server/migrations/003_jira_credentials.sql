CREATE TABLE jira_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  scopes TEXT NOT NULL
);
