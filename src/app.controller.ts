import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(@Res() res: Response) {
    // Redirect root to the SSO UI page for easier discovery in the browser
    return res.redirect('/ui/sso');
  }

  @Get('ui/sso')
  getSsoPage(@Res() res: Response) {
    const htmlPath = join(process.cwd(), 'src', 'sso', 'sso-page.html');
    const html = readFileSync(htmlPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('ui/register')
  getRegisterPage(@Res() res: Response) {
    const htmlPath = join(process.cwd(), 'src', 'sso', 'register-page.html');
    const html = readFileSync(htmlPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('ui/app-a')
  getAppAPage(@Res() res: Response) {
    const htmlPath = join(process.cwd(), 'src', 'sso', 'app-a-page.html');
    const html = readFileSync(htmlPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('ui/app-b')
  getAppBPage(@Res() res: Response) {
    const htmlPath = join(process.cwd(), 'src', 'sso', 'app-b-page.html');
    const html = readFileSync(htmlPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}
