import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Req,
  Res,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UnauthorizedException,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { SsoService } from './sso.service';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { OptionalSsoAuthGuard, SsoAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { extractSessionToken } from '../auth/session-token.util';
import { User } from '../users/user.entity';
import {
  EmailDto,
  IssueOAuthCodeDto,
  LoginDto,
  OAuthCodeExchangeDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
  UpdateProfileDto,
} from './dto/sso-write.dto';
import {
  getOAuthRedirectOrigins,
  normalizeWebOrigin,
  resolveAllowedRedirectUrl,
} from './oauth-redirect.util';
import {
  getSessionCookieClearOptions,
  getSessionCookieOptions,
  SSO_SESSION_COOKIE_NAME,
} from './session-cookie.util';
import {
  FacebookOAuthCallbackGuard,
  FacebookOAuthStartGuard,
  GoogleOAuthCallbackGuard,
  GoogleOAuthStartGuard,
  OAuthCallbackRequest,
} from './oauth-state.guard';

@Controller('sso')
export class SsoController {
  constructor(
    private readonly ssoService: SsoService,
    private readonly configService: ConfigService,
  ) {}

  private getToken(req: Request): string | undefined {
    return extractSessionToken(req);
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(
      SSO_SESSION_COOKIE_NAME,
      token,
      getSessionCookieOptions({
        nodeEnv:
          this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV,
        cookieDomain: this.configService.get<string>('SSO_COOKIE_DOMAIN'),
      }),
    );
  }

  private clearSessionCookies(res: Response) {
    const options = getSessionCookieClearOptions({
      nodeEnv:
        this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV,
      cookieDomain: this.configService.get<string>('SSO_COOKIE_DOMAIN'),
    });
    for (const cookieOptions of options) {
      res.clearCookie(SSO_SESSION_COOKIE_NAME, cookieOptions);
    }
  }

  private getAllowedRedirectOrigins(): string[] {
    return getOAuthRedirectOrigins({
      isProduction: this.configService.get<string>('NODE_ENV') === 'production',
      allowedRedirectOrigins: this.configService.get<string>(
        'ALLOWED_REDIRECT_ORIGINS',
      ),
      allowedOrigins: this.configService.get<string>('ALLOWED_ORIGINS'),
      ssoBaseUrl: this.configService.get<string>('SSO_BASE_URL'),
    });
  }

  private resolveRedirect(rawUrl: string | undefined): URL | null {
    return resolveAllowedRedirectUrl(rawUrl, this.getAllowedRedirectOrigins());
  }

  private extractRequestMetadata(req: Request) {
    // Express req.ip reflects only the configured trust-proxy chain. Never
    // trust client-supplied forwarding headers directly.
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

    const userAgent = (req.headers['user-agent'] as string) || '';
    const cfCountry = (req.headers['cf-ipcountry'] as string) || '';
    const cfCity = (req.headers['cf-ipcity'] as string) || '';

    let browser = 'Unknown Browser';
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg'))
      browser = 'Chrome';
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome'))
      browser = 'Safari';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Edg')) browser = 'Edge';

    let os = 'Unknown OS';
    if (userAgent.includes('Mac OS')) os = 'macOS';
    else if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iPhone') || userAgent.includes('iPad'))
      os = 'iOS';
    else if (userAgent.includes('Linux')) os = 'Linux';

    let deviceType = 'Desktop';
    if (
      userAgent.includes('Mobile') ||
      userAgent.includes('Android') ||
      userAgent.includes('iPhone')
    )
      deviceType = 'Mobile';
    if (userAgent.includes('iPad') || userAgent.includes('Tablet'))
      deviceType = 'Tablet';

    const city = cfCity
      ? decodeURIComponent(cfCity)
      : cfCountry === 'VN' || ip === '127.0.0.1' || ip === '::1'
        ? 'Hồ Chí Minh'
        : 'Hà Nội';
    const country = cfCountry || 'VN';

    return {
      ipAddress: ip,
      userAgent,
      metadata: {
        browser,
        os,
        deviceType,
        city,
        country,
      },
    };
  }

  // ─── GET /sso/me ──────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(OptionalSsoAuthGuard)
  me(@CurrentUser() user?: User) {
    return {
      user: user ? this.ssoService.sanitizeUser(user) : null,
    };
  }

  // ─── PATCH /sso/profile ───────────────────────────────────────────────────

  @Patch('profile')
  @UseGuards(SsoAuthGuard)
  async updateProfile(
    @CurrentUser() user: User,
    @Body() body: UpdateProfileDto,
  ) {
    const updated = await this.ssoService.updateProfile(user.id, {
      displayName: body.displayName,
      avatarUrl: body.avatarUrl,
    });
    return { success: true, user: updated };
  }

  // ─── POST /sso/avatar (upload ảnh đại diện → lưu DB) ──────────

  @Post('avatar')
  @UseGuards(SsoAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
          return cb(
            new BadRequestException(
              'Chỉ chấp nhận ảnh JPEG, PNG, GIF hoặc WebP',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Không có file nào được tải lên');
    }

    const updated = await this.ssoService.updateAvatar(
      user.id,
      file.buffer,
      file.mimetype,
    );
    return { success: true, user: updated };
  }

  // ─── GET /sso/avatar/:userId ──────────────────────────────────

  @Get('avatar/:userId')
  async getAvatar(
    @Param('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ssoService.findAvatar(userId);
    if (!result || !result.buffer) {
      throw new HttpException('Avatar not found', HttpStatus.NOT_FOUND);
    }
    res.setHeader('Content-Type', result.contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(result.buffer);
  }

  // ─── POST /sso/register ───────────────────────────────────────────────────

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() body: RegisterDto, @Req() req: Request) {
    const reqMeta = this.extractRequestMetadata(req);
    const result = await this.ssoService.register(body, reqMeta);
    return { success: true, ...result };
  }

  // ─── POST /sso/login ──────────────────────────────────────────────────────

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 15 * 60_000 } })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const appOrigin = req.headers.origin ?? req.headers.referer;
    const reqMeta = this.extractRequestMetadata(req);
    const { token, user } = await this.ssoService.login(
      {
        ...body,
        appOrigin: typeof appOrigin === 'string' ? appOrigin : undefined,
      },
      reqMeta,
    );
    this.setSessionCookie(res, token);
    return { success: true, user };
  }

  // ─── POST /sso/logout (API call từ app, trả về JSON) ──────────────────────

  @Post('logout')
  async logoutApi(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.getToken(req);
    if (token) {
      await this.ssoService.logout(token);
    }

    this.clearSessionCookies(res);

    return { success: true, message: 'Logged out successfully' };
  }

  // ─── GET /sso/logout (browser redirect flow) ──────────────────────────────

  @Get('logout')
  async logoutRedirect(
    @Req() req: Request,
    @Res() res: Response,
    @Query('redirect') redirectQuery?: string,
    @Query('redirect_uri') redirectUriQuery?: string,
  ) {
    const token = this.getToken(req);
    if (token) {
      await this.ssoService.logout(token);
    }

    this.clearSessionCookies(res);

    const redirectRaw =
      redirectQuery ||
      redirectUriQuery ||
      (req.query.redirect_url as string) ||
      (req.query.app as string) ||
      (req.query.app_url as string);

    if (redirectRaw) {
      const target = this.resolveRedirect(redirectRaw);
      if (target) {
        return res.redirect(target.toString());
      }
    }

    const base = this.configService.get<string>(
      'SSO_BASE_URL',
      'http://localhost:3000',
    );
    return res.redirect(`${base}/ui/sso?logged_out=true`);
  }

  // ─── GET /sso/oauth/google ────────────────────────────────────────────────

  @Get('oauth/google')
  @UseGuards(GoogleOAuthStartGuard)
  googleLogin() {
    // Passport redirects to Google
  }

  @Get('oauth/google/callback')
  @UseGuards(GoogleOAuthCallbackGuard)
  async googleCallback(
    @Req() req: OAuthCallbackRequest & { user?: any },
    @Res() res: Response,
  ) {
    if (!req.user) {
      throw new BadRequestException('Google OAuth failed');
    }

    const reqMeta = this.extractRequestMetadata(req);
    const { token, user } = await this.ssoService.oauthLogin(
      req.user,
      'google',
      reqMeta,
    );
    if (!user.id)
      throw new UnauthorizedException('Tài khoản OAuth không hợp lệ');
    this.setSessionCookie(res, token);

    const base = this.configService.get<string>(
      'SSO_BASE_URL',
      'http://localhost:3000',
    );
    const target = this.resolveRedirect(req.oauthRedirectTarget);
    if (target) {
      const code = await this.ssoService.createOAuthLoginCode(
        user.id,
        target.origin,
      );
      target.searchParams.delete('sso_token');
      target.searchParams.set('sso_code', code);
      return res.redirect(target.toString());
    }
    res.redirect(`${base}/ui/sso`);
  }

  // ─── GET /sso/oauth/facebook ──────────────────────────────────────────────

  @Get('oauth/facebook')
  @UseGuards(FacebookOAuthStartGuard)
  facebookLogin() {
    // Passport redirects to Facebook
  }

  @Get('oauth/facebook/callback')
  @UseGuards(FacebookOAuthCallbackGuard)
  async facebookCallback(
    @Req() req: OAuthCallbackRequest & { user?: any },
    @Res() res: Response,
  ) {
    if (!req.user) {
      throw new BadRequestException('Facebook OAuth failed');
    }

    const { token, user } = await this.ssoService.oauthLogin(
      req.user,
      'facebook',
    );
    if (!user.id)
      throw new UnauthorizedException('Tài khoản OAuth không hợp lệ');
    this.setSessionCookie(res, token);

    const base = this.configService.get<string>(
      'SSO_BASE_URL',
      'http://localhost:3000',
    );
    const target = this.resolveRedirect(req.oauthRedirectTarget);
    if (target) {
      const code = await this.ssoService.createOAuthLoginCode(
        user.id,
        target.origin,
      );
      target.searchParams.delete('sso_token');
      target.searchParams.set('sso_code', code);
      return res.redirect(target.toString());
    }
    res.redirect(`${base}/ui/sso`);
  }

  @Post('exchange')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async exchangeOAuthCode(
    @Body() body: OAuthCodeExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const origin = normalizeWebOrigin(req.headers.origin);
    if (
      !body?.code ||
      !origin ||
      !this.getAllowedRedirectOrigins().some((allowed) => {
        try {
          return new URL(allowed).origin === origin;
        } catch {
          return false;
        }
      })
    ) {
      throw new UnauthorizedException('Nguồn đăng nhập không hợp lệ');
    }
    const user = await this.ssoService.consumeOAuthLoginCode(body.code, origin);
    const token = await this.ssoService.createSessionForUser(user.id, origin);
    this.setSessionCookie(res, token);
    return { success: true, user: this.ssoService.sanitizeUser(user) };
  }

  @Post('issue-code')
  @UseGuards(SsoAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async issueOAuthCode(
    @Body() body: IssueOAuthCodeDto,
    @CurrentUser() user: User,
  ) {
    const target = this.resolveRedirect(body?.redirectUri);
    if (!target) throw new BadRequestException('Ứng dụng đích không được phép');
    const code = await this.ssoService.createOAuthLoginCode(
      user.id,
      target.origin,
    );
    target.searchParams.delete('sso_token');
    target.searchParams.set('sso_code', code);
    return { success: true, redirectUrl: target.toString() };
  }

  // ─── GET & POST /sso/verify-email ──────────────────────────────────────────

  @Get('verify-email')
  async verifyEmailGet(@Query('token') token: string, @Res() res: Response) {
    try {
      await this.ssoService.verifyEmail(token);
      res.redirect('/ui/sso?verified=true');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Xác nhận email thất bại';
      const msg = encodeURIComponent(message);
      res.redirect(`/ui/sso?verify_error=${msg}`);
    }
  }

  @Post('verify-email')
  async verifyEmail(@Body() body: TokenDto) {
    if (!body.token) {
      throw new BadRequestException('Token là bắt buộc');
    }
    const user = await this.ssoService.verifyEmail(body.token);
    return {
      success: true,
      message: 'Email đã được xác nhận thành công',
      user: user ? this.ssoService.sanitizeUser(user) : null,
    };
  }

  // ─── POST /sso/resend-verification & /sso/resend-verification-email ──────

  @Post('resend-verification')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  async resendVerification(@Body() body: EmailDto) {
    if (!body.email) {
      throw new BadRequestException('Email là bắt buộc');
    }
    await this.ssoService.resendVerificationEmail(body.email);
    return {
      success: true,
      message: 'Đã gửi lại email xác nhận. Vui lòng kiểm tra hộp thư của bạn.',
    };
  }

  @Post('resend-verification-email')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  async resendVerificationEmail(@Body() body: EmailDto) {
    if (!body.email) {
      throw new BadRequestException('Email là bắt buộc');
    }
    await this.ssoService.resendVerificationEmail(body.email);
    return {
      success: true,
      message: 'Đã gửi lại email xác nhận. Vui lòng kiểm tra hộp thư của bạn.',
    };
  }

  // ─── POST /sso/forgot-password ────────────────────────────────────────────

  @Post('forgot-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  async forgotPassword(@Body() body: EmailDto) {
    if (!body.email) {
      throw new BadRequestException('Email là bắt buộc');
    }
    await this.ssoService.requestPasswordReset(body.email);
    return {
      success: true,
      message: 'Hướng dẫn đặt lại mật khẩu đã được gửi đến email của bạn',
    };
  }

  // ─── POST /sso/reset-password ─────────────────────────────────────────────

  @Post('reset-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.token || !body.password) {
      throw new BadRequestException('Token và mật khẩu là bắt buộc');
    }
    const user = await this.ssoService.resetPassword(body.token, body.password);
    // Create new session for user after password reset
    const token = await this.ssoService.createSessionForUser(user.id);
    this.setSessionCookie(res, token);
    return {
      success: true,
      message: 'Mật khẩu đã được đặt lại thành công',
      user: this.ssoService.sanitizeUser(user),
    };
  }
}
