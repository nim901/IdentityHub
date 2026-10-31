ALTER TABLE jira_credentials ADD COLUMN refresh_status TEXT NOT NULL DEFAULT 'ready'
  CHECK (refresh_status IN ('ready', 'refreshing', 'reauthorize'));
