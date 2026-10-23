import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Response } from 'express';
import { SsoService } from '../sso/sso.service';
import {
  getLegacySessionCookieClearOptions,
  getSessionCookieOptions,
  SSO_SESSION_COOKIE_NAME,
} from '../sso/session-cookie.util';
import type { User } from '../users/user.entity';
import type { AuthenticatedRequest } from './auth.types';
import { extractSessionToken } from './session-token.util';

async function resolveRequestUser(
  context: ExecutionContext,
  ssoService: SsoService,
  configService: ConfigService,
): Promise<User | null> {
  const http = context.switchToHttp();
  const request = http.getRequest<Request & AuthenticatedRequest>();
  const token = extractSessionToken(request);
  if (!token) return null;
  const resolved = await ssoService.resolveSessionForRequest(token);
  if (!resolved) return null;
  request.user = resolved.user;

  if (resolved.rotatedToken) {
    const response = http.getResponse<Response>();
    const cookieConfiguration = {
      nodeEnv: configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV,
      cookieDomain: configService.get<string>('SSO_COOKIE_DOMAIN'),
    };
    for (const options of getLegacySessionCookieClearOptions(
      cookieConfiguration,
    )) {
      response.clearCookie(SSO_SESSION_COOKIE_NAME, options);
    }
    response.cookie(
      SSO_SESSION_COOKIE_NAME,
      resolved.rotatedToken,
      getSessionCookieOptions(cookieConfiguration),
    );
  }

  return resolved.user;
}

@Injectable()
export class SsoAuthGuard implements CanActivate {
  constructor(
    protected readonly ssoService: SsoService,
    protected readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      !(await resolveRequestUser(context, this.ssoService, this.configService))
    ) {
      throw new UnauthorizedException('Vui lòng đăng nhập');
    }
    return true;
  }
}

/** Optional auth preserves guest access while sharing the same token parser. */
@Injectable()
export class OptionalSsoAuthGuard implements CanActivate {
  constructor(
    protected readonly ssoService: SsoService,
    protected readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await resolveRequestUser(context, this.ssoService, this.configService);
    return true;
  }
}

/** Authenticated note operations historically return 403 for missing login. */
@Injectable()
export class ForbiddenSsoAuthGuard extends SsoAuthGuard {
  constructor(ssoService: SsoService, configService: ConfigService) {
    super(ssoService, configService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      !(await resolveRequestUser(context, this.ssoService, this.configService))
    ) {
      throw new ForbiddenException(
        'Vui lòng đăng nhập để thực hiện thao tác này',
      );
    }
    return true;
  }
}
