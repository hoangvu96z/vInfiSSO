import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { normalizeWebOrigin } from '../sso/oauth-redirect.util';

export function isAllowedPaymentMutationOrigin(input: {
  origin: string | undefined;
  protocol: string;
  host: string | undefined;
  allowedOrigins: string[];
}): boolean {
  const origin = normalizeWebOrigin(input.origin);
  if (!origin || !input.host || !['http', 'https'].includes(input.protocol)) {
    return false;
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(`${input.protocol}://${input.host}`).origin;
  } catch {
    return false;
  }
  if (origin === requestOrigin) return true;

  return input.allowedOrigins.some((configuredOrigin) => {
    try {
      const url = new URL(configuredOrigin);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.origin === origin
      );
    } catch {
      return false;
    }
  });
}

@Injectable()
export class PaymentOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      return true;
    }

    const configured = [
      this.config.get<string>('ALLOWED_ORIGINS'),
      this.config.get<string>('ALLOWED_REDIRECT_ORIGINS'),
      this.config.get<string>('SSO_BASE_URL'),
    ].flatMap((value) =>
      (value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    );

    if (
      !isAllowedPaymentMutationOrigin({
        origin: request.headers.origin,
        protocol: request.protocol,
        host: request.get('host'),
        allowedOrigins: configured,
      })
    ) {
      throw new ForbiddenException('Nguồn yêu cầu thanh toán không hợp lệ');
    }
    return true;
  }
}
