import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSurveySearchIndexes1720375209000 implements MigrationInterface {
  name = 'AddSurveySearchIndexes1720375209000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_surveys_code_search" ON "surveys" USING GIN (LOWER("code") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_surveys_name_search" ON "surveys" USING GIN (LOWER("name") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_surveys_name_search"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_surveys_code_search"`);
  }
}
