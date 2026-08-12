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

type PersistedRow = { id: string };
type SessionRow = { id: string; revokedAt: Date | null };
type HistoricalState = {
  userSchools: string[];
  rectifications: string[];
  submissions: string[];
  answers: string[];
  results: string[];
};
type SeedFixture = {
  adminUserId: string;
  schoolUserId: string;
  schoolId: string;
  rectificationId: string;
  surveyId: string;
  versionId: string;
  dimensionId: string;
  sectionId: string;
  questionId: string;
  optionId: string;
  campaignId: string;
  submissionId: string;
  answerId: string;
  evaluationResultId: string;
};

describeWithDatabase('SCH-05 school deactivation (PostgreSQL)', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  let adminUserId: string;
  let schoolUserId: string;
  let schoolId: string;
  let campaignId: string;
  let seedFixture: SeedFixture | undefined;

  const password = 'E2e-Sch05-2026!';
  const runId = randomUUID().replaceAll('-', '');
  const adminEmail = `admin.sch05.${runId}@example.com`;
  const schoolEmail = `school.sch05.${runId}@example.com`;

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
    seedFixture = await seedSchoolWithHistory();
    adminUserId = seedFixture.adminUserId;
    schoolUserId = seedFixture.schoolUserId;
    schoolId = seedFixture.schoolId;
    campaignId = seedFixture.campaignId;
  }, 60_000);

  afterAll(async () => {
    try {
      if (seedFixture && dataSource?.isInitialized) {
        await cleanupSeedFixture(seedFixture);
      }
    } finally {
      await app?.close();
    }
  });

  it('revokes school access without deleting history and requires a fresh login after reactivation', async () => {
    const httpServer = app.getHttpServer();
    const admin = request.agent(httpServer).set(csrfHeaders());
    const firstSchoolSession = request.agent(httpServer).set(csrfHeaders());
    const secondSchoolSession = request.agent(httpServer).set(csrfHeaders());

    await admin
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    await firstSchoolSession
      .post('/api/auth/login')
      .send({ email: schoolEmail, password })
      .expect(200);
    await secondSchoolSession
      .post('/api/auth/login')
      .send({ email: schoolEmail, password })
      .expect(200);

    await admin.get('/api/auth/me').expect(200);
    await firstSchoolSession.get('/api/auth/me').expect(200);
    await secondSchoolSession.get('/api/auth/me').expect(200);

    const historyBefore = await historicalState();
    expect(historyBefore).toMatchObject({
      userSchools: [expect.any(String)],
      rectifications: [expect.any(String)],
      submissions: [expect.any(String)],
      answers: [expect.any(String)],
      results: [expect.any(String)],
    });

    const schoolSessionsBefore = await sessionsFor(schoolUserId);
    const adminSessionsBefore = await sessionsFor(adminUserId);
    expect(schoolSessionsBefore).toHaveLength(2);
    expect(
      schoolSessionsBefore.every(({ revokedAt }) => revokedAt === null),
    ).toBe(true);
    expect(adminSessionsBefore).toHaveLength(1);
    expect(adminSessionsBefore[0].revokedAt).toBeNull();

    const deactivated = await admin
      .patch(`/api/admin/schools/${schoolId}/status`)
      .send({ isActive: false })
      .expect(200);
    expect(deactivated.body).toMatchObject({ id: schoolId, isActive: false });

    await firstSchoolSession
      .put(`/api/school/campaigns/${campaignId}/submission/draft`)
      .send({ answers: [] })
      .expect(401);
    await firstSchoolSession.get('/api/auth/me').expect(401);
    await secondSchoolSession.get('/api/auth/me').expect(401);

    const blockedLogin = await request(httpServer)
      .post('/api/auth/login')
      .set(csrfHeaders())
      .send({ email: schoolEmail, password })
      .expect(401);
    expect(blockedLogin.body).toMatchObject({
      statusCode: 401,
      message: 'Correo o contraseña incorrectos.',
    });

    const schoolSessionsAfterDeactivation = await sessionsFor(schoolUserId);
    expect(schoolSessionsAfterDeactivation.map(({ id }) => id)).toEqual(
      schoolSessionsBefore.map(({ id }) => id),
    );
    expect(
      schoolSessionsAfterDeactivation.every(
        ({ revokedAt }) => revokedAt instanceof Date,
      ),
    ).toBe(true);

    expect(await sessionsFor(adminUserId)).toEqual(adminSessionsBefore);
    await admin.get('/api/auth/me').expect(200);
    expect(await historicalState()).toEqual(historyBefore);

    const [{ userActive, schoolActive }] = await dataSource.query<
      Array<{ userActive: boolean; schoolActive: boolean }>
    >(
      `SELECT app_user.is_active AS "userActive",
              school.is_active AS "schoolActive"
       FROM users app_user
       INNER JOIN user_schools assignment ON assignment.user_id = app_user.id
       INNER JOIN schools school ON school.id = assignment.school_id
       WHERE app_user.id = $1 AND school.id = $2`,
      [schoolUserId, schoolId],
    );
    expect({ userActive, schoolActive }).toEqual({
      userActive: true,
      schoolActive: false,
    });

    const reactivated = await admin
      .patch(`/api/admin/schools/${schoolId}/status`)
      .send({ isActive: true })
      .expect(200);
    expect(reactivated.body).toMatchObject({ id: schoolId, isActive: true });

    await firstSchoolSession.get('/api/auth/me').expect(401);
    await secondSchoolSession.get('/api/auth/me').expect(401);
    expect(await sessionsFor(schoolUserId)).toEqual(
      schoolSessionsAfterDeactivation,
    );

    const freshSchoolSession = request.agent(httpServer).set(csrfHeaders());
    await freshSchoolSession
      .post('/api/auth/login')
      .send({ email: schoolEmail, password })
      .expect(200);
    await freshSchoolSession.get('/api/auth/me').expect(200);

    const schoolSessionsAfterFreshLogin = await sessionsFor(schoolUserId);
    expect(schoolSessionsAfterFreshLogin).toHaveLength(3);
    expect(
      schoolSessionsAfterFreshLogin.filter(
        ({ revokedAt }) => revokedAt === null,
      ),
    ).toHaveLength(1);
    expect(await historicalState()).toEqual(historyBefore);
    expect(await sessionsFor(adminUserId)).toEqual(adminSessionsBefore);
  }, 60_000);

  async function seedSchoolWithHistory(): Promise<SeedFixture> {
    const passwordHash = await bcrypt.hash(password, 4);

    return dataSource.transaction(async (manager) => {
      const [{ id: seededAdminUserId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO users
           (first_name, last_name, email, password_hash, role, is_active,
            must_change_password)
         VALUES ('Admin', 'SCH-05', $1, $2, 'admin', true, false)
         RETURNING id`,
        [adminEmail, passwordHash],
      );
      const [{ id: seededSchoolUserId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO users
             (first_name, last_name, email, password_hash, role, is_active,
              must_change_password)
           VALUES ('Escuela', 'SCH-05', $1, $2, 'school', true, false)
           RETURNING id`,
        [schoolEmail, passwordHash],
      );

      const cue = `SCH05-${runId.slice(0, 20)}`;
      const [{ id: seededSchoolId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO schools
           (cue, name, director_name, school_number, department, locality,
            address, education_level, management_type, scope, shift,
            referent_first_name, referent_last_name, enrollment,
            characteristics, is_active)
         VALUES ($1, 'Escuela SCH-05', 'Dirección SCH-05', $1, 'Capital',
            'Mendoza', 'Calle SCH-05 1', 'Educación común', 'Estatal', 'Urbano',
            'Simple', 'Referente', 'SCH-05', 1, '{}'::jsonb, true)
         RETURNING id`,
        [cue],
      );
      await manager.query(
        `INSERT INTO user_schools (user_id, school_id) VALUES ($1, $2)`,
        [seededSchoolUserId, seededSchoolId],
      );

      const rectificationId = randomUUID();
      const schoolSnapshot = {
        schemaVersion: 4,
        sourceRectificationId: rectificationId,
        capturedAt: new Date().toISOString(),
        name: 'Escuela SCH-05',
        cue,
        directorName: 'Dirección SCH-05',
        department: 'Capital',
        address: 'Calle SCH-05 1',
        locality: 'Mendoza',
        managementType: 'Estatal',
        scope: 'Urbano',
        educationLevel: 'Educación común',
        shift: 'Simple',
        hasKiosk: false,
        hasFoodService: false,
        isBoarding: false,
      };
      await manager.query(
        `INSERT INTO school_rectifications
           (id, school_id, period_year, actor_user_id, snapshot, rectified_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())`,
        [
          rectificationId,
          seededSchoolId,
          new Date().getUTCFullYear(),
          seededSchoolUserId,
          JSON.stringify(schoolSnapshot),
        ],
      );

      const [{ id: surveyId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO surveys (code, name, description, is_active)
         VALUES ($1, 'Cuestionario histórico SCH-05', NULL, true)
         RETURNING id`,
        [`sch05-${runId}`],
      );
      const [{ id: versionId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO survey_versions
           (survey_id, version_number, title, instructions, status, published_at)
         VALUES ($1, 1, 'Versión histórica SCH-05', NULL, 'draft', NULL)
         RETURNING id`,
        [surveyId],
      );
      const [{ id: dimensionId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO survey_dimensions
           (version_id, code, title, description, "order")
         VALUES ($1, 'sch05', 'Dimensión SCH-05', NULL, 1)
         RETURNING id`,
        [versionId],
      );
      const [{ id: sectionId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO survey_sections
           (dimension_id, code, title, description, "order")
         VALUES ($1, 'sch05', 'Sección SCH-05', NULL, 1)
         RETURNING id`,
        [dimensionId],
      );
      const [{ id: questionId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO survey_questions
           (section_id, code, type, prompt, required, "order", validation)
         VALUES ($1, 'sch05', 'single_choice', 'Pregunta histórica', true, 1,
            '{}'::jsonb)
         RETURNING id`,
        [sectionId],
      );
      const [{ id: optionId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO survey_options
           (question_id, value, label, score, "order")
         VALUES ($1, 'si', 'Sí', 100, 1)
         RETURNING id`,
        [questionId],
      );
      await manager.query(
        `UPDATE survey_versions
         SET status = 'published', published_at = now()
         WHERE id = $1`,
        [versionId],
      );
      const [{ id: seededCampaignId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO campaigns
             (name, description, type, status, survey_version_id, starts_at,
              ends_at, activated_at, closed_at)
           VALUES ('Campaña histórica SCH-05', NULL, 'annual', 'closed', $1,
              now() - interval '30 days', now() - interval '1 day',
              now() - interval '30 days', now() - interval '1 day')
           RETURNING id`,
        [versionId],
      );
      const [{ id: submissionId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO survey_submissions
           (campaign_id, school_id, survey_version_id, school_rectification_id,
            school_profile_snapshot, original_respondent_id,
            original_respondent_snapshot, status, started_at, last_saved_at,
            submitted_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 'draft',
            now() - interval '20 days', now() - interval '19 days', NULL)
         RETURNING id`,
        [
          seededCampaignId,
          seededSchoolId,
          versionId,
          rectificationId,
          JSON.stringify(schoolSnapshot),
          seededSchoolUserId,
          JSON.stringify({
            id: seededSchoolUserId,
            firstName: 'Escuela',
            lastName: 'SCH-05',
            email: schoolEmail,
          }),
        ],
      );
      const [{ id: answerId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO survey_answers
           (submission_id, question_id, option_id, answer_value)
         VALUES ($1, $2, $3, NULL)
         RETURNING id`,
        [submissionId, questionId, optionId],
      );
      await manager.query(
        `UPDATE survey_submissions
         SET status = 'submitted', submitted_at = now() - interval '19 days'
         WHERE id = $1`,
        [submissionId],
      );
      const [{ id: evaluationResultId }] = await manager.query<PersistedRow[]>(
        `INSERT INTO evaluation_results
             (submission_id, campaign_id, school_id, survey_version_id,
              general_score, general_numerator, general_denominator,
              algorithm_version, snapshot_schema_version, snapshot,
              calculated_at, calculated_by_user_id, calculation_source)
           VALUES ($1, $2, $3, $4, 100, 100, 1, 'sch05-e2e-v1', 1,
              $5::jsonb, now() - interval '19 days', $6,
              'submission_finalization')
           RETURNING id`,
        [
          submissionId,
          seededCampaignId,
          seededSchoolId,
          versionId,
          JSON.stringify({
            schemaVersion: 1,
            algorithm: { version: 'sch05-e2e-v1' },
            result: { generalScore: 100 },
            submission: { id: submissionId },
            school: { id: seededSchoolId, cue },
            survey: { versionId },
          }),
          seededSchoolUserId,
        ],
      );

      return {
        adminUserId: seededAdminUserId,
        schoolUserId: seededSchoolUserId,
        schoolId: seededSchoolId,
        rectificationId,
        surveyId,
        versionId,
        dimensionId,
        sectionId,
        questionId,
        optionId,
        campaignId: seededCampaignId,
        submissionId,
        answerId,
        evaluationResultId,
      };
    });
  }

  async function cleanupSeedFixture(fixture: SeedFixture): Promise<void> {
    await dataSource.transaction(async (manager) => {
      const userIds = [fixture.adminUserId, fixture.schoolUserId];

      await manager.query(
        `DELETE FROM audit_logs
         WHERE actor_user_id = ANY($1::uuid[]) OR entity_id = $2`,
        [userIds, fixture.schoolId],
      );
      await manager.query(
        `DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])`,
        [userIds],
      );
      await manager.query(
        `DELETE FROM password_reset_tokens WHERE user_id = ANY($1::uuid[])`,
        [userIds],
      );

      // Los registros históricos son inmutables en producción. El teardown
      // deshabilita sus triggers únicamente dentro de esta transacción y cada
      // DELETE queda dirigido a los UUID del fixture. Si algo falla, PostgreSQL
      // revierte también los ALTER TABLE y conserva todos los triggers activos.
      await manager.query(
        `ALTER TABLE survey_answers
         DISABLE TRIGGER "TRG_protect_submitted_answers"`,
      );
      await manager.query(
        `ALTER TABLE survey_submissions
         DISABLE TRIGGER "TRG_protect_submission_identity"`,
      );
      await manager.query(
        `ALTER TABLE submission_question_applicability
         DISABLE TRIGGER "TRG_protect_submitted_applicability"`,
      );
      await manager.query(
        `ALTER TABLE survey_options
         DISABLE TRIGGER "TRG_protect_published_survey_options"`,
      );
      await manager.query(
        `ALTER TABLE survey_questions
         DISABLE TRIGGER "TRG_protect_published_survey_questions"`,
      );
      await manager.query(
        `ALTER TABLE survey_sections
         DISABLE TRIGGER "TRG_protect_published_survey_sections"`,
      );
      await manager.query(
        `ALTER TABLE survey_dimensions
         DISABLE TRIGGER "TRG_protect_published_survey_dimensions"`,
      );
      await manager.query(
        `ALTER TABLE survey_versions
         DISABLE TRIGGER "TRG_protect_published_survey_versions"`,
      );
      await manager.query(
        `ALTER TABLE school_rectification_education_levels
         DISABLE TRIGGER "TRG_protect_school_rectification_levels"`,
      );
      await manager.query(
        `ALTER TABLE school_rectifications
         DISABLE TRIGGER "TRG_protect_school_rectifications"`,
      );

      await manager.query(
        `DELETE FROM evaluation_dimension_results WHERE result_id = $1`,
        [fixture.evaluationResultId],
      );
      await manager.query(`DELETE FROM evaluation_results WHERE id = $1`, [
        fixture.evaluationResultId,
      ]);
      await manager.query(
        `DELETE FROM submission_question_applicability WHERE submission_id = $1`,
        [fixture.submissionId],
      );
      await manager.query(`DELETE FROM survey_answers WHERE id = $1`, [
        fixture.answerId,
      ]);
      await manager.query(`DELETE FROM survey_submissions WHERE id = $1`, [
        fixture.submissionId,
      ]);
      await manager.query(
        `DELETE FROM campaign_schools
         WHERE campaign_id = $1 AND school_id = $2`,
        [fixture.campaignId, fixture.schoolId],
      );
      await manager.query(`DELETE FROM campaigns WHERE id = $1`, [
        fixture.campaignId,
      ]);
      await manager.query(`DELETE FROM school_rectifications WHERE id = $1`, [
        fixture.rectificationId,
      ]);
      await manager.query(
        `DELETE FROM school_user_assignment_history WHERE school_id = $1`,
        [fixture.schoolId],
      );
      await manager.query(
        `DELETE FROM user_schools WHERE user_id = $1 AND school_id = $2`,
        [fixture.schoolUserId, fixture.schoolId],
      );
      await manager.query(`DELETE FROM survey_options WHERE id = $1`, [
        fixture.optionId,
      ]);
      await manager.query(`DELETE FROM survey_questions WHERE id = $1`, [
        fixture.questionId,
      ]);
      await manager.query(`DELETE FROM survey_sections WHERE id = $1`, [
        fixture.sectionId,
      ]);
      await manager.query(`DELETE FROM survey_dimensions WHERE id = $1`, [
        fixture.dimensionId,
      ]);
      await manager.query(`DELETE FROM survey_versions WHERE id = $1`, [
        fixture.versionId,
      ]);
      await manager.query(`DELETE FROM surveys WHERE id = $1`, [
        fixture.surveyId,
      ]);

      await manager.query(
        `ALTER TABLE school_rectifications
         ENABLE TRIGGER "TRG_protect_school_rectifications"`,
      );
      await manager.query(
        `ALTER TABLE school_rectification_education_levels
         ENABLE TRIGGER "TRG_protect_school_rectification_levels"`,
      );
      await manager.query(
        `ALTER TABLE survey_versions
         ENABLE TRIGGER "TRG_protect_published_survey_versions"`,
      );
      await manager.query(
        `ALTER TABLE survey_dimensions
         ENABLE TRIGGER "TRG_protect_published_survey_dimensions"`,
      );
      await manager.query(
        `ALTER TABLE survey_sections
         ENABLE TRIGGER "TRG_protect_published_survey_sections"`,
      );
      await manager.query(
        `ALTER TABLE survey_questions
         ENABLE TRIGGER "TRG_protect_published_survey_questions"`,
      );
      await manager.query(
        `ALTER TABLE survey_options
         ENABLE TRIGGER "TRG_protect_published_survey_options"`,
      );
      await manager.query(
        `ALTER TABLE submission_question_applicability
         ENABLE TRIGGER "TRG_protect_submitted_applicability"`,
      );
      await manager.query(
        `ALTER TABLE survey_submissions
         ENABLE TRIGGER "TRG_protect_submission_identity"`,
      );
      await manager.query(
        `ALTER TABLE survey_answers
         ENABLE TRIGGER "TRG_protect_submitted_answers"`,
      );

      await manager.query(`DELETE FROM schools WHERE id = $1`, [
        fixture.schoolId,
      ]);
      await manager.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
        userIds,
      ]);
    });
  }

  async function historicalState(): Promise<HistoricalState> {
    const [userSchools, rectifications, submissions, answers, results] =
      await Promise.all([
        dataSource.query<Array<{ id: string }>>(
          `SELECT user_id::text || ':' || school_id::text AS id
           FROM user_schools WHERE school_id = $1 ORDER BY user_id`,
          [schoolId],
        ),
        dataSource.query<PersistedRow[]>(
          `SELECT id FROM school_rectifications
           WHERE school_id = $1 ORDER BY id`,
          [schoolId],
        ),
        dataSource.query<PersistedRow[]>(
          `SELECT id FROM survey_submissions WHERE school_id = $1 ORDER BY id`,
          [schoolId],
        ),
        dataSource.query<PersistedRow[]>(
          `SELECT answer.id
           FROM survey_answers answer
           INNER JOIN survey_submissions submission
             ON submission.id = answer.submission_id
           WHERE submission.school_id = $1 ORDER BY answer.id`,
          [schoolId],
        ),
        dataSource.query<PersistedRow[]>(
          `SELECT id FROM evaluation_results WHERE school_id = $1 ORDER BY id`,
          [schoolId],
        ),
      ]);
    return {
      userSchools: userSchools.map(({ id }) => id),
      rectifications: rectifications.map(({ id }) => id),
      submissions: submissions.map(({ id }) => id),
      answers: answers.map(({ id }) => id),
      results: results.map(({ id }) => id),
    };
  }

  async function sessionsFor(userId: string): Promise<SessionRow[]> {
    return dataSource.query<SessionRow[]>(
      `SELECT id, revoked_at AS "revokedAt"
       FROM auth_sessions WHERE user_id = $1 ORDER BY id`,
      [userId],
    );
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
