CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX oauth_states_session ON oauth_states(session_id_hash);
