import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserSearchIndexes1720375208000 implements MigrationInterface {
  name = 'AddUserSearchIndexes1720375208000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_first_name_search" ON "users" USING GIN (LOWER("first_name") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_last_name_search" ON "users" USING GIN (LOWER("last_name") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_email_search" ON "users" USING GIN (LOWER("email") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_users_email_search"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_last_name_search"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_users_first_name_search"`,
    );
  }
}
