import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SsoAuthGuard, OptionalSsoAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { extractSessionToken } from './session-token.util';
import type { AuthenticatedRequest } from './auth.types';
import type { SsoService } from '../sso/sso.service';
import type { User } from '../users/user.entity';

type TestRequest = Request & AuthenticatedRequest;

function makeRequest(headers: Record<string, string>): TestRequest {
  return { headers } as unknown as TestRequest;
}

function makeContext(
  request: TestRequest,
  response = { cookie: jest.fn() },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

const configService = {
  get: jest.fn<unknown, [string]>((key: string) =>
    key === 'NODE_ENV' ? 'development' : undefined,
  ),
} as unknown as ConfigService;

describe('shared SSO authentication', () => {
  it('prefers Bearer credentials and parses cookie values containing equals', () => {
    expect(
      extractSessionToken(
        makeRequest({
          authorization: 'Bearer header-token',
          cookie: 'other=value; sso_token=cookie-token',
        }),
      ),
    ).toBe('header-token');
    expect(
      extractSessionToken(
        makeRequest({ cookie: 'other=value; sso_token=abc%3Ddef%3D' }),
      ),
    ).toBe('abc=def=');
  });

  it('does not throw on malformed cookie encoding', () => {
    expect(() =>
      extractSessionToken(makeRequest({ cookie: 'sso_token=%E0%A4%A' })),
    ).not.toThrow();
    expect(
      extractSessionToken(makeRequest({ cookie: 'sso_token=%E0%A4%A' })),
    ).toBeUndefined();
  });

  it('attaches the resolved user for the CurrentUser decorator', async () => {
    const user = { id: 'user-1', role: 'user' } as unknown as User;
    const ssoService = {
      resolveSessionForRequest: jest.fn().mockResolvedValue({ user }),
    };
    const request = makeRequest({ authorization: 'Bearer token' });

    await expect(
      new SsoAuthGuard(
        ssoService as unknown as SsoService,
        configService,
      ).canActivate(makeContext(request)),
    ).resolves.toBe(true);
    expect(request).toHaveProperty('user', user);
    expect(ssoService.resolveSessionForRequest).toHaveBeenCalledWith('token');
  });

  it('keeps optional guest auth permissive and rejects required invalid sessions', async () => {
    const ssoService = {
      resolveSessionForRequest: jest.fn().mockResolvedValue(null),
    };
    const context = makeContext(
      makeRequest({ cookie: 'sso_token=expired-token' }),
    );

    await expect(
      new OptionalSsoAuthGuard(
        ssoService as unknown as SsoService,
        configService,
      ).canActivate(context),
    ).resolves.toBe(true);
    await expect(
      new SsoAuthGuard(
        ssoService as unknown as SsoService,
        configService,
      ).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sets only the deterministic replacement token in the HttpOnly cookie', async () => {
    const user = { id: 'user-1', role: 'user' } as unknown as User;
    const ssoService = {
      resolveSessionForRequest: jest
        .fn()
        .mockResolvedValue({ user, rotatedToken: 'replacement-token' }),
    };
    const response = { cookie: jest.fn(), setHeader: jest.fn() };
    const context = makeContext(
      makeRequest({ cookie: 'sso_token=old-token' }),
      response,
    );

    await expect(
      new OptionalSsoAuthGuard(
        ssoService as unknown as SsoService,
        configService,
      ).canActivate(context),
    ).resolves.toBe(true);

    expect(response.cookie).toHaveBeenCalledWith(
      'sso_token',
      'replacement-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('exposes a rotated bearer token through the CORS-readable response header', async () => {
    const user = { id: 'user-1', role: 'user' } as unknown as User;
    const ssoService = {
      resolveSessionForRequest: jest
        .fn()
        .mockResolvedValue({ user, rotatedToken: 'replacement-token' }),
    };
    const response = { cookie: jest.fn(), setHeader: jest.fn() };
    const context = makeContext(
      makeRequest({ authorization: 'Bearer old-token' }),
      response,
    );

    await expect(
      new OptionalSsoAuthGuard(
        ssoService as unknown as SsoService,
        configService,
      ).canActivate(context),
    ).resolves.toBe(true);

    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Sso-Session-Token',
      'replacement-token',
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'sso_token',
      'replacement-token',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('checks role metadata centrally and returns forbidden for a non-admin', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['admin']),
    } as unknown as Reflector;
    const request = makeRequest({});
    request.user = { id: 'user-1', role: 'user' } as unknown as User;
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });
});
