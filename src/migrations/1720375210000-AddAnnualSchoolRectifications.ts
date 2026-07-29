import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnualSchoolRectifications1720375210000 implements MigrationInterface {
  name = 'AddAnnualSchoolRectifications1720375210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "director_name" varchar(200)`,
    );
    await queryRunner.query(
      `UPDATE "schools" SET "director_name" = 'Pendiente de rectificación' WHERE "director_name" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "director_name" SET NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "schools" SET "scope" = 'Pendiente de rectificación' WHERE "scope" IS NULL OR BTRIM("scope") = ''`,
    );
    await queryRunner.query(
      `UPDATE "schools" SET "shift" = 'Pendiente de rectificación' WHERE "shift" IS NULL OR BTRIM("shift") = ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "scope" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "shift" SET NOT NULL`,
    );
    await queryRunner.query(`CREATE TABLE "school_rectifications" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "school_id" uuid NOT NULL,
      "period_year" integer NOT NULL,
      "actor_user_id" uuid,
      "snapshot" jsonb NOT NULL,
      "rectified_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_school_rectifications_period" CHECK ("period_year" >= 2000 AND "period_year" <= 2200),
      CONSTRAINT "PK_school_rectifications" PRIMARY KEY ("id"),
      CONSTRAINT "FK_school_rectifications_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_school_rectifications_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_school_rectifications_school_period" ON "school_rectifications" ("school_id", "period_year", "rectified_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_school_rectifications_school_period"`,
    );
    await queryRunner.query(`DROP TABLE "school_rectifications"`);
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "shift" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "scope" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" DROP COLUMN "director_name"`,
    );
  }
}
