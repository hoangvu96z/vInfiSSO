import { Controller, Get, Req, Res, Param } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppService } from './app.service';

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

  @Get(['ui/sso', 'ui/admin', 'ui/register'])
  getReactApp(@Res() res: Response) {
    try {
      const reactIndex = join(__dirname, '..', 'admin-ui', 'dist', 'index.html');
      if (existsSync(reactIndex)) {
        const html = readFileSync(reactIndex, 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }
    } catch (e) {}
    // Fallback to static HTML
    const html = readFileSync(join(HTML_DIR, 'admin-page.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('assets/:file')
  getReactAsset(@Param('file') file: string, @Res() res: Response) {
    try {
      const assetPath = join(__dirname, '..', 'admin-ui', 'dist', 'assets', file);
      if (existsSync(assetPath)) {
        if (file.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
        else if (file.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        return res.sendFile(assetPath);
      }
    } catch (e) {}
    return res.status(404).send('Not found');
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
