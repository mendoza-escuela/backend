import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { spanishValidationException } from '../src/common/validation/spanish-validation-errors';
import { parseFrontendOrigin } from '../src/config/frontend-origins';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

if (databaseUrl) process.env.DATABASE_URL = databaseUrl;

type CampaignSchoolsBody = {
  items: Array<{
    id: string;
    school: { id: string; cue: string; name: string };
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

describeWithDatabase('Campaign schools pagination (PostgreSQL)', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;

  const runId = randomUUID().replaceAll('-', '');
  const fixture = {
    adminId: randomUUID(),
    adminEmail: `admin.campaign-schools.${runId}@example.com`,
    surveyId: randomUUID(),
    surveyVersionId: randomUUID(),
    campaignId: randomUUID(),
    schools: [
      {
        id: randomUUID(),
        cue: `E2E-CS-${runId.slice(0, 12)}-01`,
        name: 'alfa escuela minúscula',
      },
      {
        id: randomUUID(),
        cue: `E2E-CS-${runId.slice(0, 12)}-02`,
        name: 'BETA ESCUELA MAYÚSCULA',
      },
      {
        id: randomUUID(),
        cue: `E2E-CS-${runId.slice(0, 12)}-03`,
        name: 'Gamma Escuela Mixta',
      },
    ],
  };
  const password = 'E2e-CampaignSchools-2026!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: spanishValidationException,
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
    await seedFixture();
  }, 60_000);

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) await cleanupFixture();
    } finally {
      await app?.close();
    }
  });

  it('lists case-insensitively ordered schools in stable pages without a 500', async () => {
    const admin = request.agent(app.getHttpServer()).set(csrfHeaders());
    await admin
      .post('/api/auth/login')
      .send({ email: fixture.adminEmail, password })
      .expect(200);

    const firstResponse = await admin
      .get(`/api/admin/campaigns/${fixture.campaignId}/schools`)
      .query({ page: 1, limit: 2 })
      .expect(200);
    const firstPage = firstResponse.body as CampaignSchoolsBody;

    expect(firstPage.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(firstPage.items.map(({ school }) => school.name)).toEqual([
      'alfa escuela minúscula',
      'BETA ESCUELA MAYÚSCULA',
    ]);

    const secondResponse = await admin
      .get(`/api/admin/campaigns/${fixture.campaignId}/schools`)
      .query({ page: 2, limit: 2 })
      .expect(200);
    const secondPage = secondResponse.body as CampaignSchoolsBody;

    expect(secondPage.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(secondPage.items.map(({ school }) => school.name)).toEqual([
      'Gamma Escuela Mixta',
    ]);
    expect(
      new Set(
        [...firstPage.items, ...secondPage.items].map(
          ({ school }) => school.id,
        ),
      ).size,
    ).toBe(3);
  });

  async function seedFixture() {
    const passwordHash = await bcrypt.hash(password, 4);

    await dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO users
           (id, first_name, last_name, email, password_hash, role,
            is_active, must_change_password)
         VALUES ($1, 'Admin', 'Campaign Schools E2E', $2, $3, 'admin', true, false)`,
        [fixture.adminId, fixture.adminEmail, passwordHash],
      );
      await manager.query(
        `INSERT INTO surveys (id, code, name, description, is_active)
         VALUES ($1, $2, 'Cuestionario Campaign Schools E2E', NULL, true)`,
        [fixture.surveyId, `campaign-schools-${runId}`],
      );
      await manager.query(
        `INSERT INTO survey_versions
           (id, survey_id, version_number, title, instructions, status, published_at)
         VALUES ($1, $2, 1, 'Versión Campaign Schools E2E', NULL, 'draft', NULL)`,
        [fixture.surveyVersionId, fixture.surveyId],
      );
      await manager.query(
        `INSERT INTO campaigns
           (id, name, description, type, status, survey_version_id,
            starts_at, ends_at)
         VALUES ($1, 'Etapa Schools E2E', NULL, 'annual', 'draft', $2,
            now() - interval '1 day', now() + interval '30 days')`,
        [fixture.campaignId, fixture.surveyVersionId],
      );

      for (const [index, school] of fixture.schools.entries()) {
        await manager.query(
          `INSERT INTO schools
             (id, cue, name, director_name, school_number, department,
              locality, address, education_level, management_type, scope,
              shift, referent_first_name, referent_last_name, is_active)
           VALUES ($1, $2, $3, 'Dirección E2E', $4, 'Capital', 'Mendoza',
              'Calle E2E 1', 'Primario', 'Estatal', 'Urbano', 'Mañana',
              'Referente', 'E2E', true)`,
          [
            school.id,
            school.cue,
            school.name,
            `CS-${runId.slice(0, 8)}-${index}`,
          ],
        );
        await manager.query(
          `INSERT INTO campaign_schools
             (campaign_id, school_id, assigned_by_user_id, assigned_at,
              assignment_source)
           VALUES ($1, $2, $3, now(), 'manual')`,
          [fixture.campaignId, school.id, fixture.adminId],
        );
      }
    });
  }

  async function cleanupFixture() {
    await dataSource.transaction(async (manager) => {
      await manager.query('DELETE FROM auth_sessions WHERE user_id = $1', [
        fixture.adminId,
      ]);
      await manager.query(
        'DELETE FROM campaign_schools WHERE campaign_id = $1',
        [fixture.campaignId],
      );
      await manager.query('DELETE FROM campaigns WHERE id = $1', [
        fixture.campaignId,
      ]);
      await manager.query('DELETE FROM schools WHERE id = ANY($1::uuid[])', [
        fixture.schools.map(({ id }) => id),
      ]);
      await manager.query('DELETE FROM survey_versions WHERE id = $1', [
        fixture.surveyVersionId,
      ]);
      await manager.query('DELETE FROM surveys WHERE id = $1', [
        fixture.surveyId,
      ]);
      await manager.query('DELETE FROM users WHERE id = $1', [fixture.adminId]);
    });
  }
});

function csrfHeaders(): Record<string, string> {
  return {
    Origin: parseFrontendOrigin(
      process.env.FRONTEND_URL ?? 'http://localhost:5173',
    ),
    'X-CSRF-Protection': '1',
  };
}
