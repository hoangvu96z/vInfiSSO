import { Injectable } from '@nestjs/common';

@Injectable()
export class SsoService {
  private readonly sessions = new Map<string, { user: { username: string }; expiresAt: number }>();

  login({ username, password }: { username: string; password: string }) {
    if (!username || !password) {
      throw new Error('username and password are required');
    }

    const token = `sso_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = Date.now() + 1000 * 60 * 60;
    this.sessions.set(token, { user: { username }, expiresAt });

    return { token, user: { username }, expiresAt };
  }

  resolveSession(token: string | undefined) {
    if (!token) {
      return null;
    }

    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  logout(token: string | undefined) {
    if (token) {
      this.sessions.delete(token);
    }
  }
}
