import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchoolSearchIndexes1720375207000 implements MigrationInterface {
  name = 'AddSchoolSearchIndexes1720375207000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_name_search" ON "schools" USING GIN (LOWER("name") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_cue_search" ON "schools" USING GIN (LOWER("cue") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_number_search" ON "schools" USING GIN (LOWER(COALESCE("school_number", '')) gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_schools_number_search"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_schools_cue_search"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_schools_name_search"`);
  }
}
