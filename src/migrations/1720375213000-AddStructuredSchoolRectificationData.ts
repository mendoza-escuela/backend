import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStructuredSchoolRectificationData1720375213000 implements MigrationInterface {
  name = 'AddStructuredSchoolRectificationData1720375213000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "school_shift_catalogs" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "code" character varying(80) NOT NULL,
      "label" character varying(160) NOT NULL,
      "is_active" boolean NOT NULL DEFAULT true,
      "order" integer NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_school_shift_catalogs_order" CHECK ("order" >= 0),
      CONSTRAINT "PK_school_shift_catalogs" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_school_shift_catalogs_code" ON "school_shift_catalogs" ("code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_school_shift_catalogs_active_order" ON "school_shift_catalogs" ("is_active", "order")`,
    );

    await queryRunner.query(`CREATE TABLE "education_level_catalogs" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "code" character varying(80) NOT NULL,
      "label" character varying(160) NOT NULL,
      "is_active" boolean NOT NULL DEFAULT true,
      "order" integer NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_education_level_catalogs_order" CHECK ("order" >= 0),
      CONSTRAINT "PK_education_level_catalogs" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_education_level_catalogs_code" ON "education_level_catalogs" ("code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_education_level_catalogs_active_order" ON "education_level_catalogs" ("is_active", "order")`,
    );

    await queryRunner.query(
      `ALTER TABLE "schools" ADD "shift_catalog_id" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "schools" ADD "has_kiosk" boolean`);
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "has_food_service" boolean`,
    );
    await queryRunner.query(`ALTER TABLE "schools" ADD "is_boarding" boolean`);
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "enrollment" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "enrollment" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD CONSTRAINT "CHK_schools_enrollment" CHECK ("enrollment" IS NULL OR ("enrollment" >= 0 AND "enrollment" <= 1000000))`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD CONSTRAINT "FK_schools_shift_catalog" FOREIGN KEY ("shift_catalog_id") REFERENCES "school_shift_catalogs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`CREATE TABLE "school_education_levels" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "school_id" uuid NOT NULL,
      "level_id" uuid NOT NULL,
      "enrollment" integer,
      "order" integer NOT NULL,
      CONSTRAINT "CHK_school_education_levels_enrollment" CHECK ("enrollment" IS NULL OR ("enrollment" >= 0 AND "enrollment" <= 1000000)),
      CONSTRAINT "CHK_school_education_levels_order" CHECK ("order" >= 0),
      CONSTRAINT "PK_school_education_levels" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_school_education_levels_school_level" ON "school_education_levels" ("school_id", "level_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_school_education_levels_school_order" ON "school_education_levels" ("school_id", "order")`,
    );
    await queryRunner.query(
      `ALTER TABLE "school_education_levels" ADD CONSTRAINT "FK_school_education_levels_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "school_education_levels" ADD CONSTRAINT "FK_school_education_levels_level" FOREIGN KEY ("level_id") REFERENCES "education_level_catalogs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "school_rectification_education_levels" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "rectification_id" uuid NOT NULL,
        "level_id" uuid NOT NULL,
        "level_code" character varying(80) NOT NULL,
        "level_label" character varying(160) NOT NULL,
        "enrollment" integer,
        "order" integer NOT NULL,
        CONSTRAINT "CHK_school_rectification_levels_enrollment" CHECK ("enrollment" IS NULL OR ("enrollment" >= 0 AND "enrollment" <= 1000000)),
        CONSTRAINT "CHK_school_rectification_levels_order" CHECK ("order" >= 0),
        CONSTRAINT "PK_school_rectification_education_levels" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_school_rectification_levels_rectification_level" ON "school_rectification_education_levels" ("rectification_id", "level_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_school_rectification_levels_rectification_order" ON "school_rectification_education_levels" ("rectification_id", "order")`,
    );
    await queryRunner.query(
      `ALTER TABLE "school_rectification_education_levels" ADD CONSTRAINT "FK_school_rectification_levels_rectification" FOREIGN KEY ("rectification_id") REFERENCES "school_rectifications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "school_rectification_education_levels" ADD CONSTRAINT "FK_school_rectification_levels_level" FOREIGN KEY ("level_id") REFERENCES "education_level_catalogs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `UPDATE "schools"
       SET "has_kiosk" = ("characteristics"->>'hasKiosk')::boolean
       WHERE jsonb_typeof("characteristics"->'hasKiosk') = 'boolean'`,
    );
    await queryRunner.query(
      `UPDATE "schools"
       SET "has_food_service" = ("characteristics"->>'hasFoodService')::boolean
       WHERE jsonb_typeof("characteristics"->'hasFoodService') = 'boolean'`,
    );
    await queryRunner.query(
      `UPDATE "schools"
       SET "is_boarding" = ("characteristics"->>'isBoarding')::boolean
       WHERE jsonb_typeof("characteristics"->'isBoarding') = 'boolean'`,
    );
    await queryRunner.query(`DO $$
      DECLARE
        unmapped_shifts integer;
        unmapped_levels integer;
        ambiguous_zero_enrollment integer;
      BEGIN
        SELECT COUNT(*) INTO unmapped_shifts FROM "schools"
          WHERE BTRIM(COALESCE("shift", '')) <> '' AND "shift_catalog_id" IS NULL;
        SELECT COUNT(*) INTO unmapped_levels FROM "schools"
          WHERE BTRIM(COALESCE("education_level", '')) <> ''
            AND NOT EXISTS (
              SELECT 1 FROM "school_education_levels" structured
              WHERE structured."school_id" = "schools"."id"
            );
        SELECT COUNT(*) INTO ambiguous_zero_enrollment FROM "schools"
          WHERE "enrollment" = 0;
        RAISE NOTICE 'Rectificación estructurada: % jornadas y % niveles requieren mapeo manual porque no existe catálogo oficial.', unmapped_shifts, unmapped_levels;
        RAISE NOTICE 'Rectificación estructurada: % matrículas históricas con valor 0 se conservaron sin reinterpretarlas como desconocidas.', ambiguous_zero_enrollment;
      END $$`);

    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD "school_rectification_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD "school_profile_snapshot" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD CONSTRAINT "CHK_survey_submissions_school_profile_snapshot" CHECK ("school_profile_snapshot" IS NULL OR jsonb_typeof("school_profile_snapshot") = 'object')`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD CONSTRAINT "FK_survey_submissions_rectification" FOREIGN KEY ("school_rectification_id") REFERENCES "school_rectifications"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_submission_identity"()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND OLD."status" = 'submitted' THEN
          RAISE EXCEPTION 'Las presentaciones enviadas son inmutables.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD."status" = 'submitted' THEN
            RAISE EXCEPTION 'Las presentaciones enviadas son inmutables.' USING ERRCODE = '23514';
          END IF;
          IF OLD."campaign_id" IS DISTINCT FROM NEW."campaign_id"
            OR OLD."school_id" IS DISTINCT FROM NEW."school_id"
            OR OLD."survey_version_id" IS DISTINCT FROM NEW."survey_version_id"
            OR OLD."school_rectification_id" IS DISTINCT FROM NEW."school_rectification_id"
            OR OLD."school_profile_snapshot" IS DISTINCT FROM NEW."school_profile_snapshot"
            OR OLD."original_respondent_id" IS DISTINCT FROM NEW."original_respondent_id"
            OR OLD."original_respondent_snapshot" IS DISTINCT FROM NEW."original_respondent_snapshot" THEN
            RAISE EXCEPTION 'La identidad de una presentación es inmutable.' USING ERRCODE = '23514';
          END IF;
          IF OLD."status" = 'draft' AND NEW."status" NOT IN ('draft', 'submitted') THEN
            RAISE EXCEPTION 'Transición de presentación inválida.' USING ERRCODE = '23514';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(`CREATE FUNCTION "protect_school_rectification"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Las rectificaciones históricas son inmutables.' USING ERRCODE = '23514';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_school_rectifications"
      BEFORE UPDATE OR DELETE ON "school_rectifications"
      FOR EACH ROW EXECUTE FUNCTION "protect_school_rectification"()`);
    await queryRunner.query(
      `CREATE TRIGGER "TRG_protect_school_rectification_levels"
       BEFORE UPDATE OR DELETE ON "school_rectification_education_levels"
       FOR EACH ROW EXECUTE FUNCTION "protect_school_rectification"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_school_rectification_levels" ON "school_rectification_education_levels"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_school_rectifications" ON "school_rectifications"`,
    );
    await queryRunner.query(`DROP FUNCTION "protect_school_rectification"()`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_submission_identity"()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND OLD."status" = 'submitted' THEN
          RAISE EXCEPTION 'Las presentaciones enviadas son inmutables.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD."status" = 'submitted' THEN
            RAISE EXCEPTION 'Las presentaciones enviadas son inmutables.' USING ERRCODE = '23514';
          END IF;
          IF OLD."campaign_id" IS DISTINCT FROM NEW."campaign_id"
            OR OLD."school_id" IS DISTINCT FROM NEW."school_id"
            OR OLD."survey_version_id" IS DISTINCT FROM NEW."survey_version_id"
            OR OLD."original_respondent_id" IS DISTINCT FROM NEW."original_respondent_id"
            OR OLD."original_respondent_snapshot" IS DISTINCT FROM NEW."original_respondent_snapshot" THEN
            RAISE EXCEPTION 'La identidad de una presentación es inmutable.' USING ERRCODE = '23514';
          END IF;
          IF OLD."status" = 'draft' AND NEW."status" NOT IN ('draft', 'submitted') THEN
            RAISE EXCEPTION 'Transición de presentación inválida.' USING ERRCODE = '23514';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP CONSTRAINT "FK_survey_submissions_rectification"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP CONSTRAINT "CHK_survey_submissions_school_profile_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP COLUMN "school_profile_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP COLUMN "school_rectification_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "school_rectification_education_levels" DROP CONSTRAINT "FK_school_rectification_levels_level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "school_rectification_education_levels" DROP CONSTRAINT "FK_school_rectification_levels_rectification"`,
    );
    await queryRunner.query(
      `DROP TABLE "school_rectification_education_levels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "school_education_levels" DROP CONSTRAINT "FK_school_education_levels_level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "school_education_levels" DROP CONSTRAINT "FK_school_education_levels_school"`,
    );
    await queryRunner.query(`DROP TABLE "school_education_levels"`);
    await queryRunner.query(
      `ALTER TABLE "schools" DROP CONSTRAINT "FK_schools_shift_catalog"`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" DROP CONSTRAINT "CHK_schools_enrollment"`,
    );
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "is_boarding"`);
    await queryRunner.query(
      `ALTER TABLE "schools" DROP COLUMN "has_food_service"`,
    );
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "has_kiosk"`);
    await queryRunner.query(
      `ALTER TABLE "schools" DROP COLUMN "shift_catalog_id"`,
    );
    await queryRunner.query(
      `UPDATE "schools" SET "enrollment" = 0 WHERE "enrollment" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "enrollment" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ALTER COLUMN "enrollment" SET DEFAULT 0`,
    );
    await queryRunner.query(`DROP TABLE "education_level_catalogs"`);
    await queryRunner.query(`DROP TABLE "school_shift_catalogs"`);
  }
}
