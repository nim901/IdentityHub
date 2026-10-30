import type Database from "better-sqlite3";

export type UserRecord = { id: string; email: string; password_hash: string };
export type SessionRecord = {
  id: string;
  email: string;
  csrf_token: string;
  id_hash: string;
};

export class AuthRepository {
  constructor(private readonly db: Database.Database) {}

  createUser(
    id: string,
    email: string,
    passwordHash: string,
    createdAt: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, email, passwordHash, createdAt);
  }

  findUserByEmail(email: string): UserRecord | undefined {
    return this.db
      .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
      .get(email) as UserRecord | undefined;
  }

  findSession(idHash: string, now: string): SessionRecord | undefined {
    return this.db
      .prepare(
        `
      SELECT users.id, users.email, sessions.csrf_token, sessions.id_hash
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.id_hash = ? AND sessions.expires_at > ?
    `,
      )
      .get(idHash, now) as SessionRecord | undefined;
  }

  replaceSession(
    previous: SessionRecord | undefined,
    idHash: string,
    userId: string,
    csrf: string,
    createdAt: string,
    expiresAt: string,
  ) {
    this.db.transaction(() => {
      if (previous) this.deleteSession(previous);
      this.db
        .prepare(
          "INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(idHash, userId, csrf, createdAt, expiresAt);
    })();
  }

  deleteSession(session: SessionRecord) {
    this.db
      .prepare("DELETE FROM sessions WHERE id_hash = ? AND user_id = ?")
      .run(session.id_hash, session.id);
  }
}
