import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchoolManagement1720375204000 implements MigrationInterface {
  name = 'AddSchoolManagement1720375204000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" RENAME COLUMN "code" TO "cue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "school_number" varchar(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "department" varchar(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "locality" varchar(120)`,
    );
    await queryRunner.query(`ALTER TABLE "schools" ADD "address" varchar(255)`);
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "postal_code" varchar(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "education_level" varchar(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "management_type" varchar(120)`,
    );
    await queryRunner.query(`ALTER TABLE "schools" ADD "scope" varchar(120)`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "shift" varchar(120)`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "phone" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "email" varchar(255)`);
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "referent_first_name" varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "referent_last_name" varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "referent_email" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "referent_phone" varchar(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "enrollment" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "characteristics" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "created_at" timestamptz NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "updated_at" timestamptz NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `UPDATE "schools" SET "department"='Sin especificar', "locality"='Sin especificar', "address"='Sin especificar', "education_level"='Sin especificar', "management_type"='Sin especificar', "referent_first_name"='Sin especificar', "referent_last_name"='Sin especificar'`,
    );
    for (const column of [
      'department',
      'locality',
      'address',
      'education_level',
      'management_type',
      'referent_first_name',
      'referent_last_name',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "schools" ALTER COLUMN "${column}" SET NOT NULL`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_school_number" ON "schools" ("school_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_department" ON "schools" ("department")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_locality" ON "schools" ("locality")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_education_level" ON "schools" ("education_level")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_management_type" ON "schools" ("management_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_is_active" ON "schools" ("is_active")`,
    );

    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM "user_schools" GROUP BY "school_id" HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'No se puede aplicar la asociación única: existen colegios con más de un usuario'; END IF; END $$`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_schools_one_user_per_school" ON "user_schools" ("school_id")`,
    );
    await queryRunner.query(`CREATE TABLE "school_user_assignment_history" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "school_id" uuid NOT NULL,
      "previous_user_id" uuid,
      "new_user_id" uuid,
      "actor_user_id" uuid,
      "action" varchar(20) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_school_user_assignment_history" PRIMARY KEY ("id"),
      CONSTRAINT "FK_assignment_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_assignment_previous_user" FOREIGN KEY ("previous_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_assignment_new_user" FOREIGN KEY ("new_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_assignment_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
      CONSTRAINT "CHK_assignment_action" CHECK ("action" IN ('assigned','replaced','unassigned'))
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_assignment_history_school" ON "school_user_assignment_history" ("school_id", "created_at")`,
    );
    await queryRunner.query(
      `INSERT INTO "school_user_assignment_history" ("school_id", "new_user_id", "action") SELECT "school_id", "user_id", 'assigned' FROM "user_schools"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "school_user_assignment_history"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_schools_one_user_per_school"`,
    );
    for (const index of [
      'IDX_schools_is_active',
      'IDX_schools_management_type',
      'IDX_schools_education_level',
      'IDX_schools_locality',
      'IDX_schools_department',
      'IDX_schools_school_number',
    ]) {
      await queryRunner.query(`DROP INDEX "public"."${index}"`);
    }
    for (const column of [
      'updated_at',
      'created_at',
      'is_active',
      'characteristics',
      'enrollment',
      'referent_phone',
      'referent_email',
      'referent_last_name',
      'referent_first_name',
      'email',
      'phone',
      'shift',
      'scope',
      'management_type',
      'education_level',
      'postal_code',
      'address',
      'locality',
      'department',
      'school_number',
    ]) {
      await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(
      `ALTER TABLE "schools" RENAME COLUMN "cue" TO "code"`,
    );
  }
}
