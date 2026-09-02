import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express, NextFunction, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { spanishValidationException } from './common/validation/spanish-validation-errors';
import { parseFrontendOrigin } from './config/frontend-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const trustProxyHops = Number(
    configService.get<string>('TRUST_PROXY_HOPS') ?? 0,
  );

  if (trustProxyHops > 0) {
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.set('trust proxy', trustProxyHops);
  }

  app.setGlobalPrefix('api');
  app.use(helmet());

  // Cabeceras que Helmet no emite por defecto y que ZAP reporta como ausentes.
  // Se aplican a las respuestas de la API, que sirve exclusivamente JSON y
  // descargas: no necesita cámara, micrófono ni geolocalización, y ningún otro
  // origen debe poder incrustar sus respuestas.
  // No se activa Cross-Origin-Embedder-Policy: rompería las descargas.
  app.use((_request, response: Response, next: NextFunction) => {
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    );
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.enableCors({
    origin: parseFrontendOrigin(
      configService.getOrThrow<string>('FRONTEND_URL'),
    ),
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Protection'],
    exposedHeaders: ['Content-Disposition', 'X-Survey-Version-Updated-At'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: spanishValidationException,
    }),
  );

  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
