CREATE TABLE jira_sites (
  user_id TEXT PRIMARY KEY REFERENCES jira_credentials(user_id) ON DELETE CASCADE,
  cloud_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  site_name TEXT NOT NULL
);
