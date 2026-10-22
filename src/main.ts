import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getHelmetOptions } from './security/helmet-options';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Increase JSON body limit for image attachments (TalkWithMe)
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  // Only trust a configured reverse proxy. The loopback default supports a
  // local Nginx/PM2 deployment without trusting forwarded headers from clients.
  app.set('trust proxy', process.env.TRUST_PROXY?.trim() || 'loopback');

  app.use(helmet(getHelmetOptions(process.env.NODE_ENV === 'production')));

  // CORS — no wildcard fallback. Exchange requests must come from configured
  // app origins; same-origin SSO UI traffic does not need CORS.
  const allowedOrigins = [
    process.env.ALLOWED_ORIGINS,
    process.env.ALLOWED_REDIRECT_ORIGINS,
  ]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true, // Required for cookies to be sent cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'x-guest-token',
    ],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
  console.log(
    `🚀 vInfiSSO running at http://localhost:${process.env.PORT ?? 3000}`,
  );
}
bootstrap();
