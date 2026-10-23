import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { SsoController } from './sso.controller';
import type { SsoService } from './sso.service';
import type { User } from '../users/user.entity';

function createController(
  service: object,
  config: object = { get: jest.fn() },
): SsoController {
  return new SsoController(
    service as unknown as SsoService,
    config as unknown as ConfigService,
  );
}

describe('SsoController session response', () => {
  it('does not return the internal avatar storage key from profile or upload responses', async () => {
    const updatedUser = {
      id: 'user-1',
      email: 'member@example.test',
      avatar: Buffer.from('\0vinfi-upload:v1:avatars/private.webp'),
    } as unknown as User;
    const ssoService = {
      updateProfile: jest.fn().mockResolvedValue(updatedUser),
      updateAvatar: jest.fn().mockResolvedValue(updatedUser),
    };
    const controller = createController(ssoService);

    const profileResponse = await controller.updateProfile(
      { id: 'user-1' } as User,
      {},
    );
    const avatarResponse = await controller.uploadAvatar(
      { id: 'user-1' } as User,
      {
        buffer: Buffer.from('avatar'),
        mimetype: 'image/webp',
      } as unknown as Express.Multer.File,
    );

    expect(profileResponse.user.avatar).toBeNull();
    expect(avatarResponse.user.avatar).toBeNull();
  });

  it('returns only the sanitized current user from GET /sso/me', () => {
    const user = {
      id: 'user-1',
      email: 'member@example.test',
    } as unknown as User;
    const ssoService = {
      sanitizeUser: jest.fn().mockReturnValue(user),
    };
    const controller = createController(ssoService);
    const response = controller.me(user);

    expect(response).toEqual({ user });
    expect(response).not.toHaveProperty('token');
    expect(ssoService.sanitizeUser).toHaveBeenCalledWith(user);
  });

  it('keeps GET /sso/me available for unauthenticated visitors', () => {
    const ssoService = { sanitizeUser: jest.fn() };
    const controller = createController(ssoService);

    expect(controller.me(undefined)).toEqual({ user: null });
    expect(ssoService.sanitizeUser).not.toHaveBeenCalled();
  });

  it('returns the login user without the raw session token', async () => {
    const user = { id: 'user-1', email: 'member@example.test' };
    const ssoService = {
      login: jest.fn().mockResolvedValue({ token: 'raw-session-token', user }),
    };
    const controller = createController(ssoService, {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV'
          ? 'production'
          : key === 'SSO_COOKIE_DOMAIN'
            ? '.vunph.click'
            : undefined,
      ),
    });
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
    const controller = createController(ssoService);
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
    const controller = createController(ssoService, configService);
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
    const setHeader = jest.fn();
    const response = { cookie, setHeader } as unknown as Response;

    const result = await controller.exchangeOAuthCode(
      { code: 'one-time-code' },
      req,
      response,
    );

    expect(result).toEqual({
      success: true,
      user,
      token: 'new-session-token',
    });
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
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('clears the host-only cookie on logout by default', async () => {
    const controller = createController(
      { logout: jest.fn() },
      {
        get: jest.fn((key: string) =>
          key === 'NODE_ENV' ? 'production' : undefined,
        ),
      },
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

  it('preserves cookie and header token parsing with "=" values during POST /sso/logout and GET /sso/logout', async () => {
    const ssoService = { logout: jest.fn().mockResolvedValue(undefined) };
    const controller = createController(ssoService, {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'development' : undefined,
      ),
    });
    const clearCookie = jest.fn();
    const response = {
      clearCookie,
      redirect: jest.fn(),
    } as unknown as Response;

    // POST /sso/logout with cookie containing encoded '=' values
    const reqWithCookie = {
      headers: { cookie: 'other=val; sso_token=token%3Dwith%3Dequals%3D%3D' },
      query: {},
    } as unknown as Request;
    await controller.logoutApi(reqWithCookie, response);
    expect(ssoService.logout).toHaveBeenLastCalledWith('token=with=equals==');

    // POST /sso/logout with Bearer token containing '=' values
    const reqWithHeader = {
      headers: { authorization: 'Bearer header=token=value==' },
      query: {},
    } as unknown as Request;
    await controller.logoutApi(reqWithHeader, response);
    expect(ssoService.logout).toHaveBeenLastCalledWith('header=token=value==');

    // GET /sso/logout with cookie containing encoded '=' values
    await controller.logoutRedirect(reqWithCookie, response);
    expect(ssoService.logout).toHaveBeenLastCalledWith('token=with=equals==');

    // GET /sso/logout with Bearer token containing '=' values
    await controller.logoutRedirect(reqWithHeader, response);
    expect(ssoService.logout).toHaveBeenLastCalledWith('header=token=value==');

    expect(ssoService.logout).toHaveBeenCalledTimes(4);
  });

  it('rejects code exchange when the Origin header is missing or not allowlisted', async () => {
    const ssoService = { consumeOAuthLoginCode: jest.fn() };
    const configService = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const controller = createController(ssoService, configService);
    const response = {
      cookie: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as Response;

    await expect(
      controller.exchangeOAuthCode(
        { code: 'one-time-code' },
        {
          headers: { origin: 'https://evil.example.test' },
        } as unknown as Request,
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
    const response = {
      cookie: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as Response;
    const productionConfig = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      ),
    };
    const productionController = createController(ssoService, productionConfig);

    await expect(
      productionController.exchangeOAuthCode(
        { code: 'one-time-code' },
        { headers: { origin: 'http://localhost:5173' } } as unknown as Request,
        response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ssoService.consumeOAuthLoginCode).not.toHaveBeenCalled();

    const explicitlyConfiguredController = createController(ssoService, {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ALLOWED_REDIRECT_ORIGINS') {
          return 'http://localhost:5173';
        }
        return undefined;
      }),
    });
    await expect(
      explicitlyConfiguredController.exchangeOAuthCode(
        { code: 'one-time-code' },
        { headers: { origin: 'http://localhost:5173' } } as unknown as Request,
        response,
      ),
    ).resolves.toEqual({
      success: true,
      user: { id: 'user-1' },
      token: 'session-token',
    });
  });

  it('does not issue a production OAuth redirect code for a default localhost target', async () => {
    const ssoService = {
      oauthLogin: jest
        .fn()
        .mockResolvedValue({ token: 'session-token', user: { id: 'user-1' } }),
      createOAuthLoginCode: jest.fn(),
    };
    const controller = createController(ssoService, {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'SSO_BASE_URL') return 'https://sso.vunph.click';
        return undefined;
      }),
    });
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
    const controller = createController(ssoService, configService);
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

  it('ensures spoofed cf-ipcountry, cf-ipcity, and x-forwarded-for cannot change audit IP/country/city for an untrusted direct request', async () => {
    const user = { id: 'user-1', email: 'member@example.test' };
    type AuditMetadata = {
      ipAddress?: string;
      userAgent?: string;
      metadata?: {
        browser?: string;
        os?: string;
        deviceType?: string;
        city?: string | null;
        country?: string | null;
      };
    };

    const loginMock = jest
      .fn<
        Promise<{ token: string; user: typeof user }>,
        [
          { email: string; password: string; appOrigin?: string },
          AuditMetadata | undefined,
        ]
      >()
      .mockResolvedValue({ token: 'raw-session-token', user });
    const registerMock = jest
      .fn<
        Promise<{ message: string; email: string }>,
        [
          { email: string; password: string; displayName?: string },
          AuditMetadata | undefined,
        ]
      >()
      .mockResolvedValue({ message: 'ok', email: 'member@example.test' });

    const ssoService = {
      login: loginMock,
      register: registerMock,
    };
    const controller = createController(ssoService);
    const cookie = jest.fn();
    const clearCookie = jest.fn();
    const response = { cookie, clearCookie } as unknown as Response;

    const directSocketAddress = '203.0.113.10';

    // Baseline request without spoofing headers
    const directRequest = {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      ip: directSocketAddress,
      socket: { remoteAddress: directSocketAddress },
    } as unknown as Request;

    // Direct request with spoofed geo and proxy forwarding headers
    const spoofedDirectRequest = {
      headers: {
        'cf-ipcountry': 'US',
        'cf-ipcity': 'San%20Francisco',
        'x-forwarded-for': '198.51.100.24, 10.0.0.1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      ip: directSocketAddress,
      socket: { remoteAddress: directSocketAddress },
    } as unknown as Request;

    await controller.login(
      { email: user.email, password: 'valid-password' },
      directRequest,
      response,
    );
    const baselineLoginMeta = loginMock.mock.calls[0][1];

    await controller.login(
      { email: user.email, password: 'valid-password' },
      spoofedDirectRequest,
      response,
    );
    const spoofedLoginMeta = loginMock.mock.calls[1][1];

    expect(spoofedLoginMeta?.ipAddress).toBe(directSocketAddress);
    expect(spoofedLoginMeta?.ipAddress).not.toBe('198.51.100.24');
    expect(spoofedLoginMeta?.metadata?.country).toBeNull();
    expect(spoofedLoginMeta?.metadata?.city).toBeNull();

    // The spoofed request yields the exact same audit IP, country, and city as the baseline
    expect(spoofedLoginMeta?.ipAddress).toBe(baselineLoginMeta?.ipAddress);
    expect(spoofedLoginMeta?.metadata?.country).toBe(
      baselineLoginMeta?.metadata?.country,
    );
    expect(spoofedLoginMeta?.metadata?.city).toBe(
      baselineLoginMeta?.metadata?.city,
    );

    // Verify the same protection on registration
    await controller.register(
      { email: 'new@example.test', password: 'password123' },
      spoofedDirectRequest,
    );
    const spoofedRegisterMeta = registerMock.mock.calls[0][1];
    expect(spoofedRegisterMeta?.ipAddress).toBe(directSocketAddress);
    expect(spoofedRegisterMeta?.metadata?.country).toBeNull();
    expect(spoofedRegisterMeta?.metadata?.city).toBeNull();
  });
});
