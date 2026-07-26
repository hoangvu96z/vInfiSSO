import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SsoService } from '../sso/sso.service';

const COOKIE_NAME = 'sso_token';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly ssoService: SsoService) {}

  private getToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.substring(7).trim();
    }
    const raw = req.headers.cookie ?? '';
    const entry = raw
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAME}=`));
    if (!entry) return undefined;
    const [, val] = entry.split('=');
    return val ? decodeURIComponent(val) : undefined;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.getToken(req);
    if (!token) {
      throw new UnauthorizedException('Vui lòng đăng nhập để truy cập trang quản trị');
    }

    const user = await this.ssoService.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException('Phiên làm việc hết hạn hoặc không hợp lệ');
    }

    if (user.role !== 'admin') {
      throw new ForbiddenException('Bạn không có quyền truy cập trang quản trị (Admin Only)');
    }

    (req as any).user = user;
    return true;
  }
}
