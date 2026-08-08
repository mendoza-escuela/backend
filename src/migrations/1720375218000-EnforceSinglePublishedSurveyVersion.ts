import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceSinglePublishedSurveyVersion1720375218000 implements MigrationInterface {
  name = 'EnforceSinglePublishedSurveyVersion1720375218000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$
      DECLARE conflicting_surveys text;
      BEGIN
        SELECT string_agg(conflict."survey_id"::text, ', ')
        INTO conflicting_surveys
        FROM (
          SELECT "survey_id"
          FROM "survey_versions"
          WHERE "status" = 'published'
          GROUP BY "survey_id"
          HAVING COUNT(*) > 1
        ) conflict;

        IF conflicting_surveys IS NOT NULL THEN
          RAISE EXCEPTION 'Existen cuestionarios con más de una versión publicada.'
            USING ERRCODE = '23514',
                  DETAIL = 'Cuestionarios inconsistentes: ' || conflicting_surveys,
                  HINT = 'Archive manualmente las versiones incorrectas antes de reintentar la migración.';
        END IF;
      END;
    $$`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_versions_single_published" ON "survey_versions" ("survey_id") WHERE "status" = 'published'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_survey_versions_single_published"`,
    );
  }
}
