import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SsoService } from './sso.service';

@Controller('sso')
export class SsoController {
  constructor(private readonly ssoService: SsoService) {}

  private getTokenFromCookie(req: Request) {
    const cookieHeader = req.headers.cookie ?? '';
    const cookieEntry = cookieHeader
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('sso_token='));

    if (!cookieEntry) {
      return undefined;
    }

    const [, rawValue] = cookieEntry.split('=');
    return rawValue ? decodeURIComponent(rawValue) : undefined;
  }

  @Get('me')
  me(@Req() req: Request) {
    const token = this.getTokenFromCookie(req);
    const session = this.ssoService.resolveSession(token);
    return { user: session?.user ?? null };
  }

  @Post('login')
  login(@Body() body: { username: string; password: string }, @Res({ passthrough: true }) res: Response) {
    const session = this.ssoService.login(body);
    res.cookie('sso_token', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60,
    });
    return { success: true, user: session.user };
  }

  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.getTokenFromCookie(req);
    this.ssoService.logout(token);
    res.clearCookie('sso_token', { path: '/' });
    return { success: true };
  }
}
