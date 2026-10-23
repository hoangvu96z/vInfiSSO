import { BadRequestException, ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import passport from 'passport';
import {
  FacebookOAuthCallbackGuard,
  FacebookOAuthStartGuard,
  GoogleOAuthCallbackGuard,
  GoogleOAuthStartGuard,
  OAuthCallbackRequest,
} from './oauth-state.guard';
import { SsoController } from './sso.controller';
import type { SsoService } from './sso.service';
import type { User } from '../users/user.entity';
import {
  createOAuthStateGrant,
  getOAuthStateCookieName,
} from './oauth-state.util';

const sessionSecret =
  'stable-session-signing-secret-with-more-than-32-characters';
const redirectUrl =
  'https://app.example.test/reading/callback?view=weekly&sso_token=stale#result';

function createConfigService() {
  return {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'SESSION_SECRET') return sessionSecret;
      if (key === 'NODE_ENV') return 'production';
      if (key === 'ALLOWED_REDIRECT_ORIGINS') return 'https://app.example.test';
      if (key === 'SSO_BASE_URL') return 'https://sso.vunph.click';
      return fallback;
    }),
  } as unknown as ConfigService;
}

function createContext(request: Request, response: Response): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

type AuthenticateCallback = (
  error: Error | null,
  user?: { providerId: string },
  info?: unknown,
  status?: number,
) => void;

describe('OAuth return-to-app callback', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['google', 'facebook'] as const)(
    'restores the allowlisted full redirect through the %s callback',
    async (provider) => {
      let observedState: string | undefined;
      const authenticateImplementation = ((
        strategy: string,
        options: { state?: string },
        callback?: AuthenticateCallback,
      ) => {
        expect(strategy).toBe(provider);
        observedState = options.state;
        return (request: Request, response: Response, next: NextFunction) => {
          void request;
          void response;
          if (callback) {
            callback(null, { providerId: 'provider-user' }, undefined, 200);
          } else {
            next();
          }
        };
      }) as unknown as typeof passport.authenticate;
      jest
        .spyOn(passport, 'authenticate')
        .mockImplementation(authenticateImplementation);

      const configService = createConfigService();
      const startRequest = {
        query: { redirect: redirectUrl },
      } as unknown as Request;
      let capturedCookie:
        { name: string; value: string; options: CookieOptions } | undefined;
      const startCookie = jest.fn(
        (name: string, value: string, options: CookieOptions) => {
          capturedCookie = { name, value, options };
        },
      );
      const startResponse = { cookie: startCookie } as unknown as Response;
      const startContext = createContext(startRequest, startResponse);
      const startGuard =
        provider === 'google'
          ? new GoogleOAuthStartGuard(configService)
          : new FacebookOAuthStartGuard(configService);

      await startGuard.canActivate(startContext);

      expect(observedState).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(capturedCookie).toBeDefined();
      const {
        name: cookieName,
        value: cookieValue,
        options: cookieOptions,
      } = capturedCookie!;
      expect(cookieName).toBe(getOAuthStateCookieName(provider));
      expect(cookieOptions).toEqual(
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: `/sso/oauth/${provider}`,
        }),
      );

      const callbackRequest = {
        query: {
          state: observedState,
          // Callback query parameters must never be trusted as a redirect.
          redirect: 'https://attacker.example.test/steal',
        },
        headers: { cookie: `${cookieName}=${cookieValue}` },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as OAuthCallbackRequest & { user?: User };
      const clearCookie = jest.fn();
      const callbackContext = createContext(callbackRequest, {
        clearCookie,
      } as unknown as Response);
      const callbackGuard =
        provider === 'google'
          ? new GoogleOAuthCallbackGuard(configService)
          : new FacebookOAuthCallbackGuard(configService);

      await callbackGuard.canActivate(callbackContext);

      expect(callbackRequest.oauthRedirectTarget).toBe(
        new URL(redirectUrl).toString(),
      );
      expect(clearCookie).toHaveBeenCalledWith(
        cookieName,
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: `/sso/oauth/${provider}`,
        }),
      );

      const user = { id: 'user-1', email: 'member@example.test' };
      const ssoService = {
        oauthLogin: jest.fn().mockResolvedValue({
          token: 'session-token',
          user,
        }),
        createOAuthLoginCode: jest.fn().mockResolvedValue('one-time-code'),
      };
      const controller = new SsoController(
        ssoService as unknown as SsoService,
        configService,
      );
      const cookie = jest.fn();
      const redirect = jest.fn((url: string | URL) => url);
      const response = { cookie, redirect } as unknown as Response;
      const callback =
        provider === 'google'
          ? controller.googleCallback.bind(controller)
          : controller.facebookCallback.bind(controller);

      await callback(callbackRequest, response);

      expect(ssoService.createOAuthLoginCode).toHaveBeenCalledWith(
        'user-1',
        'https://app.example.test',
      );
      const finalUrl = new URL(redirect.mock.calls[0][0]);
      expect(finalUrl.pathname).toBe('/reading/callback');
      expect(finalUrl.searchParams.get('view')).toBe('weekly');
      expect(finalUrl.searchParams.get('sso_token')).toBeNull();
      expect(finalUrl.searchParams.get('sso_code')).toBe('one-time-code');
      expect(finalUrl.hash).toBe('#result');
    },
  );

  it('rejects a callback state mismatch before Passport can authenticate', async () => {
    const grant = createOAuthStateGrant(
      'google',
      'https://app.example.test/callback',
      sessionSecret,
    );
    const authenticate = jest.spyOn(passport, 'authenticate');
    const configService = createConfigService();
    const request = {
      query: { state: `${grant.state}x` },
      headers: {
        cookie: `${getOAuthStateCookieName('google')}=${grant.cookieValue}`,
      },
    } as unknown as Request;
    const guard = new GoogleOAuthCallbackGuard(configService);

    await expect(
      guard.canActivate(
        createContext(request, {
          clearCookie: jest.fn(),
        } as unknown as Response),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
