import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getCorsOptions } from './security/cors-options';
import { createCsrfOriginMiddleware } from './security/csrf-origin.middleware';
import { getHelmetOptions } from './security/helmet-options';
import { createRequestBodyParsers } from './security/request-body-parsers';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Only trust a configured reverse proxy. The loopback default supports a
  // local Nginx/PM2 deployment without trusting forwarded headers from clients.
  app.set('trust proxy', process.env.TRUST_PROXY?.trim() || 'loopback');

  // Helmet reads this value while building the request's CSP header. Legacy
  // demo pages that still need inline scripts receive the same nonce in HTML.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = randomBytes(18).toString('base64');
    next();
  });
  app.use(helmet(getHelmetOptions(process.env.NODE_ENV === 'production')));

  // No wildcard fallback: cross-origin browser requests require an explicitly
  // configured application origin. Same-origin SSO UI traffic needs no CORS.
  app.enableCors(getCorsOptions());

  // Credentialed cross-site cookies require a source-origin check on mutations.
  // Keep this before body parsing and routes; OAuth callbacks remain top-level
  // GETs protected by their independent Lax state cookie and signed state.
  app.use(createCsrfOriginMiddleware());

  // The contact message endpoint accepts image attachments up to 5 MiB. Keep
  // parsers after Helmet/CORS so parser errors also receive response headers,
  // and use the smaller default limit for every other route.
  const bodyParsers = createRequestBodyParsers();
  app.use(bodyParsers.json);
  app.use(bodyParsers.urlencoded);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
  console.log(
    `🚀 vInfiSSO running at http://localhost:${process.env.PORT ?? 3000}`,
  );
}
bootstrap();
