import {
  Controller,
  Get,
  INestApplication,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuditMiddleware } from './audit.middleware';
import { AuditService } from './services/audit.service';
import { identifyAuditActor } from './audit-context';
import { SafeHttpExceptionFilter } from '../../common/filters/safe-http-exception.filter';
import { CsrfProtectionGuard } from '../../common/guards/csrf-protection.guard';
import { ConfigService } from '@nestjs/config';

const actorId = '413a5c5c-1743-4f88-b15b-5cd6950b18b3';
@Controller()
class FixtureController {
  @Post('auth/login') login() {
    identifyAuditActor(actorId);
    throw new UnauthorizedException();
  }
  @Get('failure') failure() {
    throw new Error('password=secret SQL parameters');
  }
  @Post('auth/logout') logout() {
    identifyAuditActor(actorId);
    return { ok: true };
  }
}

describe('HTTP audit including guards and failures', () => {
  let app: INestApplication;
  const record = jest.fn().mockResolvedValue(undefined);
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FixtureController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const middleware = new AuditMiddleware({
      record,
    } as unknown as AuditService);
    app.use((req: Request, res: Response, next: NextFunction) =>
      middleware.use(req, res, next),
    );
    app.useGlobalFilters(new SafeHttpExceptionFilter(app.getHttpAdapter()));
    app.useGlobalGuards(
      new CsrfProtectionGuard({
        getOrThrow: () => 'https://app.example.com',
      } as unknown as ConfigService),
    );
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => record.mockClear());

  it('registra fallos de login con actor y origen, sin cuerpo ni query string', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/auth/login?token=private')
      .set('Origin', 'https://app.example.com')
      .set('X-CSRF-Protection', '1')
      .send({ password: 'private' })
      .expect(401);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTH_LOGIN_FAILED',
        actorUserId: actorId,
        requestId: response.headers['x-request-id'],
        sourceIp: expect.any(String) as unknown,
        changes: expect.objectContaining({
          route: '/api/auth/login',
          statusCode: 401,
        }) as unknown,
      }),
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('private');
  });
  it('registra rechazos CSRF aun cuando el controlador no se ejecuta', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/auth/logout')
      .expect(403);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        changes: expect.objectContaining({
          reason: 'CSRF_REJECTED',
        }) as unknown,
      }),
    );
  });
  it('registra logout y evita filtrar errores internos', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/auth/logout')
      .set('Origin', 'https://app.example.com')
      .set('X-CSRF-Protection', '1')
      .expect(201);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTH_LOGOUT_SUCCESS',
        actorUserId: actorId,
      }),
    );
    const response = await request(app.getHttpServer() as Server)
      .get('/api/failure')
      .expect(500);
    expect(response.text).not.toContain('secret');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'HTTP_SERVER_ERROR',
        severity: 'error',
      }),
    );
  });
});
