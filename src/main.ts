import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getCorsOptions } from './security/cors-options';
import { getHelmetOptions } from './security/helmet-options';
import { createRequestBodyParsers } from './security/request-body-parsers';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Only trust a configured reverse proxy. The loopback default supports a
  // local Nginx/PM2 deployment without trusting forwarded headers from clients.
  app.set('trust proxy', process.env.TRUST_PROXY?.trim() || 'loopback');

  app.use(helmet(getHelmetOptions(process.env.NODE_ENV === 'production')));

  // No wildcard fallback: cross-origin browser requests require an explicitly
  // configured application origin. Same-origin SSO UI traffic needs no CORS.
  app.enableCors(getCorsOptions());

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
