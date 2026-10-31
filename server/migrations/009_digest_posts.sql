CREATE TABLE digest_posts (
  user_id TEXT NOT NULL REFERENCES users(id),
  post_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'unknown', 'done')),
  issue_key TEXT,
  issue_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(user_id, post_url)
);
