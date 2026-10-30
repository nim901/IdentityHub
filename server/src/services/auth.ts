import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import argon2 from "argon2";
import type Database from "better-sqlite3";
import { AuthRepository, type SessionRecord } from "../db/authRepository.js";

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly dummyHash = argon2.hash(randomToken(), {
    type: argon2.argon2id,
  });

  constructor(db: Database.Database) {
    this.repository = new AuthRepository(db);
  }

  async register(email: string, password: string) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      this.repository.createUser(
        randomUUID(),
        email,
        passwordHash,
        new Date().toISOString(),
      );
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE")
        return false;
      throw error;
    }
  }

  async login(email: string, password: string, oldToken?: string) {
    const user = this.repository.findUserByEmail(email);
    const matches = await argon2.verify(
      user?.password_hash ?? (await this.dummyHash),
      password,
    );
    if (!user || !matches) return null;

    const token = randomToken();
    const csrfToken = randomToken();
    const now = Date.now();
    this.repository.replaceSession(
      this.session(oldToken),
      hashToken(token),
      user.id,
      csrfToken,
      new Date(now).toISOString(),
      new Date(now + SESSION_LIFETIME_MS).toISOString(),
    );
    return { token, csrfToken, user: { id: user.id, email: user.email } };
  }

  session(token?: string): SessionRecord | undefined {
    if (!token) return undefined;
    return this.repository.findSession(
      hashToken(token),
      new Date().toISOString(),
    );
  }

  validCsrf(session: SessionRecord, token: string | undefined) {
    if (!token) return false;
    const expected = Buffer.from(session.csrf_token);
    const actual = Buffer.from(token);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  logout(session: SessionRecord) {
    this.repository.deleteSession(session);
  }
}
