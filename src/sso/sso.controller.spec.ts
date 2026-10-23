import { UnauthorizedException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { SsoController } from './sso.controller';
import type { User } from '../users/user.entity';

describe('SsoController session response', () => {
  it('returns only the sanitized current user from GET /sso/me', () => {
    const user = {
      id: 'user-1',
      email: 'member@example.test',
    } as unknown as User;
    const ssoService = {
      sanitizeUser: jest.fn().mockReturnValue(user),
    };
    const controller = new SsoController(
      ssoService as any,
      { get: jest.fn() } as any,
    );
    const response = controller.me(user);

    expect(response).toEqual({ user });
    expect(response).not.toHaveProperty('token');
    expect(ssoService.sanitizeUser).toHaveBeenCalledWith(user);
  });

  it('keeps GET /sso/me available for unauthenticated visitors', () => {
    const ssoService = { sanitizeUser: jest.fn() };
    const controller = new SsoController(
      ssoService as any,
      { get: jest.fn() } as any,
    );

    expect(controller.me(undefined)).toEqual({ user: null });
    expect(ssoService.sanitizeUser).not.toHaveBeenCalled();
  });

  it('returns the login user without the raw session token', async () => {
    const user = { id: 'user-1', email: 'member@example.test' };
    const ssoService = {
      login: jest.fn().mockResolvedValue({ token: 'raw-session-token', user }),
    };
    const controller = new SsoController(
      ssoService as any,
      {
        get: jest.fn((key: string) =>
          key === 'NODE_ENV'
            ? 'production'
            : key === 'SSO_COOKIE_DOMAIN'
              ? '.vunph.click'
              : undefined,
        ),
      } as any,
    );
    const cookie = jest.fn(
      (name: string, value: string, options: CookieOptions) => ({
        name,
        value,
        options,
      }),
    );
    const clearCookie = jest.fn();
    const response = { cookie, clearCookie } as unknown as Response;
    const request = {
      headers: { origin: 'https://vunph.click', 'user-agent': 'test' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    const result = await controller.login(
      { email: user.email, password: 'valid-password' },
      request,
      response,
    );

    expect(result).toEqual({ success: true, user });
    expect(result).not.toHaveProperty('token');
    expect(cookie).toHaveBeenCalledWith(
      'sso_token',
      'raw-session-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'none',
        secure: true,
      }),
    );
    expect(cookie.mock.calls[0][2].domain).toBeUndefined();
    expect(clearCookie).toHaveBeenCalledWith(
      'sso_token',
      expect.objectContaining({ domain: '.vunph.click', secure: true }),
    );
    expect(clearCookie.mock.invocationCallOrder[0]).toBeLessThan(
      cookie.mock.invocationCallOrder[0],
    );
  });

  it('returns a cookie-only session after resetting the password', async () => {
    const user = { id: 'user-1', email: 'member@example.test' };
    const ssoService = {
      resetPassword: jest.fn().mockResolvedValue(user),
      createSessionForUser: jest.fn().mockResolvedValue('raw-session-token'),
      sanitizeUser: jest.fn().mockReturnValue(user),
    };
    const controller = new SsoController(
      ssoService as any,
      { get: jest.fn() } as any,
    );
    const cookie = jest.fn(
      (name: string, value: string, options: CookieOptions) => ({
        name,
        value,
        options,
      }),
    );
    const response = { cookie } as unknown as Response;

    const result = await controller.resetPassword(
      { token: 'reset-token', password: 'new-valid-password' },
      response,
    );

    expect(result).toEqual({
      success: true,
      message: 'Mật khẩu đã được đặt lại thành công',
      user,
    });
    expect(result).not.toHaveProperty('token');
    expect(ssoService.resetPassword).toHaveBeenCalledWith(
      'reset-token',
      'new-valid-password',
    );
    expect(cookie).toHaveBeenCalledTimes(1);
    expect(cookie.mock.calls[0][0]).toBe('sso_token');
    expect(cookie.mock.calls[0][1]).toBe('raw-session-token');
    expect(cookie.mock.calls[0][2].httpOnly).toBe(true);
    expect(typeof cookie.mock.calls[0][2].maxAge).toBe('number');
  });

  it('exchanges an allowed-origin single-use code into an SSO session', async () => {
    const user = { id: 'user-1', email: 'member@example.test' };
    const ssoService = {
      consumeOAuthLoginCode: jest.fn().mockResolvedValue(user),
      createSessionForUser: jest.fn().mockResolvedValue('new-session-token'),
      sanitizeUser: jest.fn().mockReturnValue(user),
    };
    const configService = {
      get: jest.fn((key: string, fallback: string) =>
        key === 'ALLOWED_REDIRECT_ORIGINS'
          ? 'https://app.example.test,http://localhost:5173'
          : fallback,
      ),
    };
    const controller = new SsoController(
      ssoService as any,
      configService as any,
    );
    const req = {
      headers: { origin: 'http://localhost:5173' },
    } as unknown as Request;
    const cookie = jest.fn(
      (name: string, value: string, options: CookieOptions) => ({
        name,
        value,
        options,
      }),
    );
    const response = { cookie } as unknown as Response;

    const result = await controller.exchangeOAuthCode(
      { code: 'one-time-code' },
      req,
      response,
    );

    expect(result).toEqual({ success: true, user });
    expect(result).not.toHaveProperty('token');
    expect(ssoService.consumeOAuthLoginCode).toHaveBeenCalledWith(
      'one-time-code',
      'http://localhost:5173',
    );
    expect(ssoService.createSessionForUser).toHaveBeenCalledWith(
      'user-1',
      'http://localhost:5173',
    );
    expect(cookie).toHaveBeenCalledTimes(1);
    expect(cookie.mock.calls[0][0]).toBe('sso_token');
    expect(cookie.mock.calls[0][1]).toBe('new-session-token');
    expect(cookie.mock.calls[0][2].httpOnly).toBe(true);
    expect(typeof cookie.mock.calls[0][2].maxAge).toBe('number');
  });

  it('clears the host-only cookie on logout by default', async () => {
    const controller = new SsoController(
      { logout: jest.fn() } as any,
      {
        get: jest.fn((key: string) =>
          key === 'NODE_ENV' ? 'production' : undefined,
        ),
      } as any,
    );
    const clearCookie = jest.fn();
    const response = { clearCookie } as unknown as Response;

    await controller.logoutApi({ headers: {} } as unknown as Request, response);

    expect(clearCookie).toHaveBeenCalledTimes(1);
    expect(clearCookie).toHaveBeenCalledWith(
      'sso_token',
      expect.objectContaining({
        path: '/',
        sameSite: 'none',
        secure: true,
        httpOnly: true,
      }),
    );
  });

  it('rejects code exchange when the Origin header is missing or not allowlisted', async () => {
    const ssoService = { consumeOAuthLoginCode: jest.fn() };
    const configService = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const controller = new SsoController(
      ssoService as any,
      configService as any,
    );
    const response = { cookie: jest.fn() } as unknown as Response;

    await expect(
      controller.exchangeOAuthCode(
        { code: 'one-time-code' },
        { headers: { origin: 'https://evil.example.test' } } as any,
        response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ssoService.consumeOAuthLoginCode).not.toHaveBeenCalled();
  });

  it('rejects localhost exchange in production unless it is explicitly configured', async () => {
    const ssoService = {
      consumeOAuthLoginCode: jest.fn().mockResolvedValue({ id: 'user-1' }),
      createSessionForUser: jest.fn().mockResolvedValue('session-token'),
      sanitizeUser: jest.fn().mockReturnValue({ id: 'user-1' }),
    };
    const response = { cookie: jest.fn() } as unknown as Response;
    const productionConfig = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      ),
    };
    const productionController = new SsoController(
      ssoService as any,
      productionConfig as any,
    );

    await expect(
      productionController.exchangeOAuthCode(
        { code: 'one-time-code' },
        { headers: { origin: 'http://localhost:5173' } } as unknown as Request,
        response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ssoService.consumeOAuthLoginCode).not.toHaveBeenCalled();

    const explicitlyConfiguredController = new SsoController(
      ssoService as any,
      {
        get: jest.fn((key: string) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'ALLOWED_REDIRECT_ORIGINS') {
            return 'http://localhost:5173';
          }
          return undefined;
        }),
      } as any,
    );
    await expect(
      explicitlyConfiguredController.exchangeOAuthCode(
        { code: 'one-time-code' },
        { headers: { origin: 'http://localhost:5173' } } as unknown as Request,
        response,
      ),
    ).resolves.toEqual({
      success: true,
      user: { id: 'user-1' },
    });
  });

  it('does not issue a production OAuth redirect code for a default localhost target', async () => {
    const ssoService = {
      oauthLogin: jest
        .fn()
        .mockResolvedValue({ token: 'session-token', user: { id: 'user-1' } }),
      createOAuthLoginCode: jest.fn(),
    };
    const controller = new SsoController(
      ssoService as any,
      {
        get: jest.fn((key: string) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'SSO_BASE_URL') return 'https://sso.vunph.click';
          return undefined;
        }),
      } as any,
    );
    const req = {
      user: { providerId: 'provider-user' },
      query: { redirect: 'http://localhost:5173/callback' },
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Parameters<typeof controller.googleCallback>[0];
    const redirect = jest.fn((location: string | URL) => location);
    const response = { cookie: jest.fn(), redirect } as unknown as Response;

    await controller.googleCallback(req, response);

    expect(ssoService.createOAuthLoginCode).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('https://sso.vunph.click/ui/sso');
  });

  it('redirects OAuth callbacks with a one-time code instead of the bearer token', async () => {
    const user = { id: 'user-1', email: 'member@example.test' };
    const ssoService = {
      oauthLogin: jest
        .fn()
        .mockResolvedValue({ token: 'raw-session-token', user }),
      createOAuthLoginCode: jest.fn().mockResolvedValue('opaque-one-time-code'),
    };
    const configService = {
      get: jest.fn((key: string, fallback: string) =>
        key === 'ALLOWED_REDIRECT_ORIGINS'
          ? 'https://app.example.test'
          : fallback,
      ),
    };
    const controller = new SsoController(
      ssoService as any,
      configService as any,
    );
    const req = {
      user: { providerId: 'provider-user' },
      oauthRedirectTarget:
        'https://app.example.test/callback?sso_token=old-value',
      query: {},
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Parameters<typeof controller.googleCallback>[0];
    const redirect = jest.fn((location: string | URL) => location);
    const response = {
      cookie: jest.fn(),
      redirect,
    } as unknown as Response;

    await controller.googleCallback(req, response);

    expect(ssoService.createOAuthLoginCode).toHaveBeenCalledWith(
      'user-1',
      'https://app.example.test',
    );
    const redirectUrl = new URL(redirect.mock.calls[0][0]);
    expect(redirectUrl.searchParams.get('sso_code')).toBe(
      'opaque-one-time-code',
    );
    expect(redirectUrl.searchParams.has('sso_token')).toBe(false);
    expect(redirect).toHaveBeenCalledTimes(1);
  });
});
