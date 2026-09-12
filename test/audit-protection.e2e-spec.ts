import { DataSource } from 'typeorm';
import { AuditSubscriber } from '../src/modules/audit/audit.subscriber';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { MonitoringService } from '../src/modules/health/services/monitoring.service';
import { AuditService } from '../src/modules/audit/services/audit.service';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import * as bcrypt from 'bcrypt';
import { User } from '../src/modules/users/entities/user.entity';
import { UserRole } from '../src/modules/users/entities/user-role.enum';

const url = process.env.TEST_AUDIT_DATABASE_URL;
const databaseSuite = url ? describe : describe.skip;
databaseSuite('Auditoría en PostgreSQL aislado', () => {
  let db: DataSource;
  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      url,
      entities: [__dirname + '/../src/modules/**/*.entity.ts'],
      migrations: [__dirname + '/../src/migrations/*.ts'],
      subscribers: [AuditSubscriber],
      synchronize: false,
    });
    await db.initialize();
    await db.runMigrations();
  }, 120_000);
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('persiste cambios de rol sin secretos y bloquea edición, borrado y truncado', async () => {
    const event = await db.getRepository(AuditLog).save({
      action: 'USER_UPDATED',
      entityType: 'user',
      changes: {
        role: { from: 'school', to: 'admin' },
        password: 'never-log-me',
      },
    });
    const stored = await db
      .getRepository(AuditLog)
      .findOneByOrFail({ id: event.id });
    expect(stored.changes).toEqual({
      role: { from: 'school', to: 'admin' },
      password: '[redacted]',
    });
    await expect(
      db.query('UPDATE audit_logs SET action = $1 WHERE id = $2', [
        'FORGED',
        event.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query('DELETE FROM audit_logs WHERE id = $1', [event.id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('TRUNCATE audit_logs')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('aplica rollback y up sin perder eventos existentes', async () => {
    const before = await db.getRepository(AuditLog).count();
    await db.undoLastMigration();
    await db.undoLastMigration();
    await db.runMigrations();
    expect(await db.getRepository(AuditLog).count()).toBe(before);
  });

  it('separa permisos de runtime y mantenimiento; sólo purga eventos mayores a 365 días', async () => {
    await db.query('CREATE ROLE eps_runtime NOLOGIN');
    await db.query('CREATE ROLE eps_audit_retention NOLOGIN');
    await db.query(
      'GRANT USAGE ON SCHEMA public TO eps_runtime, eps_audit_retention',
    );
    await db.query('GRANT SELECT, INSERT ON audit_logs TO eps_runtime');
    await db.query('GRANT SELECT, DELETE ON audit_logs TO eps_audit_retention');
    const [expired] = await db.query<
      Array<{ id: string }>
    >(`INSERT INTO audit_logs(action,entity_type,created_at)
      VALUES ('EXPIRED_TEST','test',now() - interval '366 days') RETURNING id`);
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('SET ROLE eps_runtime');
      await runner.query(
        "INSERT INTO audit_logs(action,entity_type) VALUES ('RUNTIME_EVENT','test')",
      );
      await expect(
        runner.query('DELETE FROM audit_logs'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runner.query('ALTER TABLE audit_logs DISABLE TRIGGER ALL'),
      ).rejects.toMatchObject({ code: '42501' });
      await runner.query('RESET ROLE');
      await runner.query('SET ROLE eps_audit_retention');
      await runner.query('DELETE FROM audit_logs WHERE id = $1', [expired.id]);
      await expect(
        runner.query("DELETE FROM audit_logs WHERE action = 'RUNTIME_EVENT'"),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await runner.query('RESET ROLE');
      await runner.release();
    }
    expect(
      await db.getRepository(AuditLog).findOneBy({ id: expired.id }),
    ).toBeNull();
  });

  it('informa la supervisión interna y la cuenta demasiado privilegiada', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    const service = new MonitoringService(
      db,
      new ConfigService({ FRONTEND_URL: 'http://frontend.test' }),
      new AuditService(db),
      {
        isConfigured: () => false,
        sendServiceHealthAlert: jest.fn(),
      } as never,
    );
    const status = await service.status();
    expect(status.monitoring).toMatchObject({
      mode: 'internal',
      status: 'ok',
      latest: { database: true, frontend: true },
    });
    expect(status.alerts.ready).toBe(false);
    expect(status.retention).toMatchObject({
      minimumDays: 365,
      triggersInstalled: true,
      protected: false,
      runtimePrivileged: true,
    });
    fetchSpy.mockRestore();
  });

  it('integra login real, middleware global y consulta administrativa', async () => {
    process.env.DATABASE_URL = url;
    process.env.JWT_SECRET =
      'isolated-test-signing-secret-not-a-production-credential';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.FRONTEND_URL = 'http://localhost:5173';
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    try {
      const user = await db.getRepository(User).save({
        firstName: 'Audit',
        lastName: 'Test',
        email: 'audit-integration@example.test',
        passwordHash: await bcrypt.hash('Test-Audit!2026', 12),
        role: UserRole.Admin,
        isActive: true,
        mustChangePassword: false,
      });
      const agent = request.agent(app.getHttpServer() as Server);
      await agent
        .post('/api/auth/login')
        .set('Origin', process.env.FRONTEND_URL)
        .set('X-CSRF-Protection', '1')
        .send({ email: user.email, password: 'Test-Audit!2026' })
        .expect(200);
      await agent.get('/api/admin/audit?limit=5').expect(200);
      await agent.get('/api/admin/monitoring').expect(200);
      await request(app.getHttpServer() as Server)
        .get('/api/admin/audit')
        .expect(401);
      const login = await db
        .getRepository(AuditLog)
        .findOneBy({ action: 'AUTH_LOGIN_SUCCESS', actorUserId: user.id });
      expect(login?.requestId).toBeTruthy();
      expect(login?.sourceIp).toBeTruthy();
      expect(JSON.stringify(login)).not.toContain('Test-Audit!2026');
      // Espera escrituras de finish antes de cerrar las conexiones del proceso de prueba.
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      await app.close();
    }
  }, 60_000);
});
