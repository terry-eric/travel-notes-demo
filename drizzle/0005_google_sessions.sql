-- Application-owned Google login; only SHA-256 digests of opaque cookies are stored.
CREATE TABLE auth_identities (
  google_sub TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE auth_login_challenges (
  token_hash TEXT PRIMARY KEY NOT NULL,
  nonce_hash TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_login_challenges_expiry ON auth_login_challenges(expires_at);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX auth_sessions_subject_created ON auth_sessions(google_sub,created_at);
