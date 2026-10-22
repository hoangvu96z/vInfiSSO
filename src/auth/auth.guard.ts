import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SsoService } from '../sso/sso.service';
import type { User } from '../users/user.entity';
import type { AuthenticatedRequest } from './auth.types';
import { extractSessionToken } from './session-token.util';

async function resolveRequestUser(
  request: Request & AuthenticatedRequest,
  ssoService: SsoService,
): Promise<User | null> {
  const token = extractSessionToken(request);
  if (!token) return null;
  const user = await ssoService.resolveSession(token);
  if (user) request.user = user;
  return user;
}

@Injectable()
export class SsoAuthGuard implements CanActivate {
  constructor(protected readonly ssoService: SsoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & AuthenticatedRequest>();
    if (!(await resolveRequestUser(request, this.ssoService))) {
      throw new UnauthorizedException('Vui lòng đăng nhập');
    }
    return true;
  }
}

/** Optional auth preserves guest access while sharing the same token parser. */
@Injectable()
export class OptionalSsoAuthGuard implements CanActivate {
  constructor(protected readonly ssoService: SsoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & AuthenticatedRequest>();
    await resolveRequestUser(request, this.ssoService);
    return true;
  }
}

/** Authenticated note operations historically return 403 for missing login. */
@Injectable()
export class ForbiddenSsoAuthGuard extends SsoAuthGuard {
  constructor(ssoService: SsoService) {
    super(ssoService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & AuthenticatedRequest>();
    if (!(await resolveRequestUser(request, this.ssoService))) {
      throw new ForbiddenException(
        'Vui lòng đăng nhập để thực hiện thao tác này',
      );
    }
    return true;
  }
}
