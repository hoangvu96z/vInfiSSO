import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  getOAuthRedirectOrigins,
  resolveAllowedRedirectUrl,
} from './oauth-redirect.util';
import {
  createOAuthStateGrant,
  getOAuthStateCookieClearOptions,
  getOAuthStateCookieName,
  getOAuthStateCookieOptions,
  OAuthProvider,
  readUniqueCookie,
  restoreOAuthStateGrant,
} from './oauth-state.util';

export interface OAuthCallbackRequest extends Request {
  oauthRedirectTarget?: string;
}

interface OAuthStartRequest extends Request {
  oauthState?: string;
}

function getSecret(configService: ConfigService): string {
  const secret = configService.get<string>('SESSION_SECRET');
  if (!secret || secret.trim().length < 32) {
    throw new InternalServerErrorException(
      'OAuth state signing is not configured',
    );
  }
  return secret;
}

function getAllowedRedirectOrigins(configService: ConfigService): string[] {
  return getOAuthRedirectOrigins({
    isProduction: configService.get<string>('NODE_ENV') === 'production',
    allowedRedirectOrigins: configService.get<string>(
      'ALLOWED_REDIRECT_ORIGINS',
    ),
    allowedOrigins: configService.get<string>('ALLOWED_ORIGINS'),
    ssoBaseUrl: configService.get<string>('SSO_BASE_URL'),
  });
}

function getRedirectInput(request: Request): string | undefined {
  const values = [
    request.query.redirect,
    request.query.redirect_uri,
    request.query.redirect_url,
    request.query.app,
    request.query.app_url,
  ];
  return values.find((value): value is string => typeof value === 'string');
}

function prepareOAuthStart(
  provider: OAuthProvider,
  configService: ConfigService,
  request: OAuthStartRequest,
  response: Response,
): void {
  const allowedOrigins = getAllowedRedirectOrigins(configService);
  const redirect = resolveAllowedRedirectUrl(
    getRedirectInput(request),
    allowedOrigins,
  );
  const grant = createOAuthStateGrant(
    provider,
    redirect?.toString() ?? null,
    getSecret(configService),
  );

  request.oauthState = grant.state;
  response.cookie(
    getOAuthStateCookieName(provider),
    grant.cookieValue,
    getOAuthStateCookieOptions(provider, configService.get<string>('NODE_ENV')),
  );
}

function restoreOAuthTarget(
  provider: OAuthProvider,
  configService: ConfigService,
  request: OAuthCallbackRequest,
  response: Response,
): void {
  const cookieName = getOAuthStateCookieName(provider);
  const grant = restoreOAuthStateGrant(
    readUniqueCookie(request.headers.cookie, cookieName),
    request.query.state,
    provider,
    getSecret(configService),
    getAllowedRedirectOrigins(configService),
  );
  if (!grant)
    throw new BadRequestException('OAuth state is invalid or expired');

  request.oauthRedirectTarget = grant.redirectTo?.toString();
  const clearOptions = getOAuthStateCookieClearOptions(
    provider,
    configService.get<string>('NODE_ENV'),
  );
  response.clearCookie(cookieName, clearOptions);
}

@Injectable()
export class GoogleOAuthStartGuard extends AuthGuard('google') {
  constructor(configService: ConfigService) {
    super();
    this.configService = configService;
  }

  private readonly configService: ConfigService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OAuthStartRequest>();
    prepareOAuthStart(
      'google',
      this.configService,
      request,
      context.switchToHttp().getResponse<Response>(),
    );
    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions(context: ExecutionContext): { state?: string } {
    return {
      state: context.switchToHttp().getRequest<OAuthStartRequest>().oauthState,
    };
  }
}

@Injectable()
export class FacebookOAuthStartGuard extends AuthGuard('facebook') {
  constructor(configService: ConfigService) {
    super();
    this.configService = configService;
  }

  private readonly configService: ConfigService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OAuthStartRequest>();
    prepareOAuthStart(
      'facebook',
      this.configService,
      request,
      context.switchToHttp().getResponse<Response>(),
    );
    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions(context: ExecutionContext): { state?: string } {
    return {
      state: context.switchToHttp().getRequest<OAuthStartRequest>().oauthState,
    };
  }
}

@Injectable()
export class GoogleOAuthCallbackGuard extends AuthGuard('google') {
  constructor(configService: ConfigService) {
    super();
    this.configService = configService;
  }

  private readonly configService: ConfigService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    restoreOAuthTarget(
      'google',
      this.configService,
      http.getRequest<OAuthCallbackRequest>(),
      http.getResponse<Response>(),
    );
    return (await super.canActivate(context)) as boolean;
  }
}

@Injectable()
export class FacebookOAuthCallbackGuard extends AuthGuard('facebook') {
  constructor(configService: ConfigService) {
    super();
    this.configService = configService;
  }

  private readonly configService: ConfigService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    restoreOAuthTarget(
      'facebook',
      this.configService,
      http.getRequest<OAuthCallbackRequest>(),
      http.getResponse<Response>(),
    );
    return (await super.canActivate(context)) as boolean;
  }
}
