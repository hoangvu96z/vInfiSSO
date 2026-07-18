import { SsoService } from './sso.service';

describe('SsoService', () => {
  it('creates and resolves a session for the same user', () => {
    const service = new SsoService();

    const session = service.login({ username: 'alice', password: 'secret' });

    expect(session.user.username).toBe('alice');
    expect(session.token).toBeTruthy();

    const resolved = service.resolveSession(session.token);
    expect(resolved?.user.username).toBe('alice');
  });
});
