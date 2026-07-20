import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { SsoService } from './sso.service';
import { ConfigService } from '@nestjs/config';

const COOKIE_NAME = 'sso_token';
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_OPTIONS = {
  httpOnly: true,
  // SameSite=None;Secure bắt buộc để cookie cross-domain (sso.vunph.click → vunph.id.vn)
  // Dev dùng lax vì HTTP không hỗ trợ Secure
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  secure: isProd,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
};

@Controller('sso')
export class SsoController {
  constructor(
    private readonly ssoService: SsoService,
    private readonly configService: ConfigService,
  ) {}

  private getToken(req: Request): string | undefined {
    // 1. Check Authorization header: Bearer <token>
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.substring(7).trim();
    }

    // 2. Fallback to Cookie
    const raw = req.headers.cookie ?? '';
    const entry = raw
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAME}=`));
    if (!entry) return undefined;
    const [, val] = entry.split('=');
    return val ? decodeURIComponent(val) : undefined;
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  }

  // ─── GET /sso/me ──────────────────────────────────────────────────────────

  @Get('me')
  async me(@Req() req: Request) {
    const token = this.getToken(req);
    const user = await this.ssoService.resolveSession(token);
    return {
      user: user ? this.ssoService.sanitizeUser(user) : null,
      token: user ? token : null,
    };
  }

  // ─── POST /sso/register ───────────────────────────────────────────────────

  @Post('register')
  async register(
    @Body() body: { email: string; password: string; displayName?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.ssoService.register(body);
    this.setSessionCookie(res, token);
    return { success: true, token, user };
  }

  // ─── POST /sso/login ──────────────────────────────────────────────────────

  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appOrigin = req.headers.origin ?? req.headers.referer;
    const { token, user } = await this.ssoService.login({
      ...body,
      appOrigin: typeof appOrigin === 'string' ? appOrigin : undefined,
    });
    this.setSessionCookie(res, token);
    return { success: true, token, user };
  }

  // ─── POST /sso/logout ─────────────────────────────────────────────────────

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.getToken(req);
    await this.ssoService.logout(token);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { success: true };
  }

  // ─── GET /sso/oauth/google ────────────────────────────────────────────────

  @Get('oauth/google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport redirects to Google
  }

  @Get('oauth/google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request & { user?: any },
    @Res() res: Response,
  ) {
    if (!req.user) {
      throw new BadRequestException('Google OAuth failed');
    }

    const { token } = await this.ssoService.oauthLogin(req.user, 'google');
    this.setSessionCookie(res, token);

    // Redirect back to the app or SSO home
    const redirect = this.configService.get<string>('SSO_BASE_URL', 'http://localhost:3000');
    res.redirect(`${redirect}/ui/sso`);
  }

  // ─── GET /sso/oauth/facebook ──────────────────────────────────────────────

  @Get('oauth/facebook')
  @UseGuards(AuthGuard('facebook'))
  facebookLogin() {
    // Passport redirects to Facebook
  }

  @Get('oauth/facebook/callback')
  @UseGuards(AuthGuard('facebook'))
  async facebookCallback(
    @Req() req: Request & { user?: any },
    @Res() res: Response,
  ) {
    if (!req.user) {
      throw new BadRequestException('Facebook OAuth failed');
    }

    const { token } = await this.ssoService.oauthLogin(req.user, 'facebook');
    this.setSessionCookie(res, token);

    const redirect = this.configService.get<string>('SSO_BASE_URL', 'http://localhost:3000');
    res.redirect(`${redirect}/ui/sso`);
  }
}
