import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const describeWithDatabase = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithDatabase('Application health (e2e)', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports application and PostgreSQL readiness', async () => {
    const server = app.getHttpServer();
    const applicationHealth = await request(server)
      .get('/api/health')
      .expect(200);
    expect(applicationHealth.body as { status: string }).toMatchObject({
      status: 'ok',
    });

    const databaseHealth = await request(server)
      .get('/api/health/database')
      .expect(200);
    const databaseHealthBody = databaseHealth.body as {
      status: string;
      database: string;
      latencyMs: number;
    };
    expect(databaseHealthBody).toMatchObject({
      status: 'ok',
      database: 'postgres',
    });
    expect(databaseHealthBody.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
