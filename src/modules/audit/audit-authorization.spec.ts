import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PasswordChangeRequiredGuard } from '../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminAuditController } from './controllers/admin-audit.controller';
import { AdminMonitoringController } from '../health/controllers/admin-monitoring.controller';
import { AuditService } from './services/audit.service';
import { MonitoringService } from '../health/services/monitoring.service';
import request from 'supertest';
import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

describe('Permisos del panel de auditoría', () => {
  let app: INestApplication;
  const list = jest.fn().mockResolvedValue({ items: [] });
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuditController, AdminMonitoringController],
      providers: [
        RolesGuard,
        { provide: AuditService, useValue: { list } },
        {
          provide: MonitoringService,
          useValue: { status: () => ({ api: 'ok' }) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PasswordChangeRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.use(
      (
        req: Request & { user?: { role: string } },
        _res: Response,
        next: NextFunction,
      ) => {
        const role = req.header('x-test-role');
        if (role) req.user = { role };
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(() => app.close());
  it.each(['/admin/audit', '/admin/monitoring'])(
    'deniega acceso escolar y anónimo a %s',
    async (route) => {
      await request(app.getHttpServer() as Server)
        .get(route)
        .expect(403);
      await request(app.getHttpServer() as Server)
        .get(route)
        .set('x-test-role', 'school')
        .expect(403);
      await request(app.getHttpServer() as Server)
        .get(route)
        .set('x-test-role', 'admin')
        .expect(200);
    },
  );
  it('rechaza paginación, filtros arbitrarios y fechas inválidas', async () => {
    for (const query of [
      'limit=1000',
      'requestId=bad',
      'from=not-a-date',
      'unknown=x',
    ]) {
      await request(app.getHttpServer() as Server)
        .get(`/admin/audit?${query}`)
        .set('x-test-role', 'admin')
        .expect(400);
    }
  });
});
