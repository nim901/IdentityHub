CREATE TABLE finding_operations (
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'unknown', 'done')),
  issue_key TEXT,
  PRIMARY KEY (user_id, key_hash)
);
CREATE TABLE created_issues (
  user_id TEXT NOT NULL REFERENCES users(id),
  cloud_id TEXT NOT NULL,
  project_key TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  title TEXT NOT NULL,
  site_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, cloud_id, issue_key)
);
CREATE INDEX created_issues_recent ON created_issues(user_id, cloud_id, project_key, created_at DESC);
