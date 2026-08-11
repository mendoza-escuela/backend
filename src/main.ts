import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
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
  app.enableCors({
    origin: parseFrontendOrigin(
      configService.getOrThrow<string>('FRONTEND_URL'),
    ),
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Protection'],
    exposedHeaders: ['Content-Disposition'],
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
