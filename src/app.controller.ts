import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppService } from './app.service';

// __dirname trỏ tới dist/ sau khi build
// HTML files được copy vào dist/ bởi nest-cli assets config
const HTML_DIR = join(__dirname, 'sso');

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(@Res() res: Response) {
    return res.redirect('/ui/sso');
  }

  @Get(['login', 'sso/login', 'ui/login'])
  redirectToLogin(@Req() req: Request, @Res() res: Response) {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    return res.redirect(`/ui/sso${query}`);
  }

  @Get(['register', 'sso/register_page'])
  redirectToRegister(@Req() req: Request, @Res() res: Response) {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    return res.redirect(`/ui/register${query}`);
  }

  @Get('ui/sso')
  getSsoPage(@Res() res: Response) {
    const html = readFileSync(join(HTML_DIR, 'sso-page.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('ui/register')
  getRegisterPage(@Res() res: Response) {
    const html = readFileSync(join(HTML_DIR, 'register-page.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('ui/app-a')
  getAppAPage(@Res() res: Response) {
    try {
      const html = readFileSync(join(HTML_DIR, 'app-a-page.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch {
      res.status(404).send('Not found');
    }
  }

  @Get('ui/app-b')
  getAppBPage(@Res() res: Response) {
    try {
      const html = readFileSync(join(HTML_DIR, 'app-b-page.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch {
      res.status(404).send('Not found');
    }
  }

  @Get(['admin', 'sso/admin', 'ui/admin'])
  getAdminPage(@Res() res: Response) {
    try {
      const html = readFileSync(join(HTML_DIR, 'admin-page.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch {
      res.status(404).send('Not found');
    }
  }

  @Get(['vlnfi_sso_favicon_option_1.svg', 'vinfi_sso_favicon_option_1.svg', 'favicon.ico'])
  getFavicon(@Res() res: Response) {
    try {
      const svg = readFileSync(join(HTML_DIR, 'vlnfi_sso_favicon_option_1.svg'), 'utf8');
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(svg);
    } catch {
      res.status(404).send('Not found');
    }
  }
}
