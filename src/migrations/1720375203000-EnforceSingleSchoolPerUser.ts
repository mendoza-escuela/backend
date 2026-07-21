import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceSingleSchoolPerUser1720375203000 implements MigrationInterface {
  name = 'EnforceSingleSchoolPerUser1720375203000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_schools_one_school_per_user" ON "user_schools" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_schools_one_school_per_user"`,
    );
  }
}
