import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVersionedSurveys1720375205000 implements MigrationInterface {
  name = 'AddVersionedSurveys1720375205000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."survey_versions_status_enum" AS ENUM('draft', 'published', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."survey_questions_type_enum" AS ENUM('single_choice', 'multiple_choice', 'boolean', 'short_text', 'long_text', 'number', 'date')`,
    );
    await queryRunner.query(`CREATE TABLE "surveys" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "code" varchar(80) NOT NULL,
      "name" varchar(255) NOT NULL,
      "description" text,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_surveys" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_surveys_code" ON "surveys" ("code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_surveys_is_active" ON "surveys" ("is_active")`,
    );
    await queryRunner.query(`CREATE TABLE "survey_versions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "survey_id" uuid NOT NULL,
      "version_number" integer NOT NULL,
      "title" varchar(255) NOT NULL,
      "instructions" text,
      "status" "public"."survey_versions_status_enum" NOT NULL DEFAULT 'draft',
      "published_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_survey_versions" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_survey_versions_positive_number" CHECK ("version_number" > 0),
      CONSTRAINT "CHK_survey_versions_published_at" CHECK (("status" = 'published' AND "published_at" IS NOT NULL) OR "status" <> 'published'),
      CONSTRAINT "FK_survey_versions_survey" FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_versions_status" ON "survey_versions" ("status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_versions_survey_number" ON "survey_versions" ("survey_id", "version_number")`,
    );
    await queryRunner.query(`CREATE TABLE "survey_dimensions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "version_id" uuid NOT NULL,
      "code" varchar(80) NOT NULL,
      "title" varchar(255) NOT NULL,
      "description" text,
      "order" integer NOT NULL,
      CONSTRAINT "PK_survey_dimensions" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_survey_dimensions_order" CHECK ("order" >= 0),
      CONSTRAINT "FK_survey_dimensions_version" FOREIGN KEY ("version_id") REFERENCES "survey_versions"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_dimensions_version_code" ON "survey_dimensions" ("version_id", "code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_dimensions_version_order" ON "survey_dimensions" ("version_id", "order")`,
    );
    await queryRunner.query(`CREATE TABLE "survey_sections" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "dimension_id" uuid NOT NULL,
      "code" varchar(80) NOT NULL,
      "title" varchar(255) NOT NULL,
      "description" text,
      "order" integer NOT NULL,
      CONSTRAINT "PK_survey_sections" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_survey_sections_order" CHECK ("order" >= 0),
      CONSTRAINT "FK_survey_sections_dimension" FOREIGN KEY ("dimension_id") REFERENCES "survey_dimensions"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_sections_dimension_code" ON "survey_sections" ("dimension_id", "code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_sections_dimension_order" ON "survey_sections" ("dimension_id", "order")`,
    );
    await queryRunner.query(`CREATE TABLE "survey_questions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "section_id" uuid NOT NULL,
      "code" varchar(80) NOT NULL,
      "type" "public"."survey_questions_type_enum" NOT NULL,
      "prompt" text NOT NULL,
      "help_text" text,
      "required" boolean NOT NULL DEFAULT false,
      "order" integer NOT NULL,
      "validation" jsonb NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT "PK_survey_questions" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_survey_questions_order" CHECK ("order" >= 0),
      CONSTRAINT "CHK_survey_questions_validation_object" CHECK (jsonb_typeof("validation") = 'object'),
      CONSTRAINT "FK_survey_questions_section" FOREIGN KEY ("section_id") REFERENCES "survey_sections"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_questions_section_code" ON "survey_questions" ("section_id", "code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_questions_section_order" ON "survey_questions" ("section_id", "order")`,
    );
    await queryRunner.query(`CREATE TABLE "survey_options" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "question_id" uuid NOT NULL,
      "value" varchar(120) NOT NULL,
      "label" varchar(500) NOT NULL,
      "help_text" text,
      "order" integer NOT NULL,
      CONSTRAINT "PK_survey_options" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_survey_options_order" CHECK ("order" >= 0),
      CONSTRAINT "FK_survey_options_question" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_options_question_value" ON "survey_options" ("question_id", "value")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_options_question_order" ON "survey_options" ("question_id", "order")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "survey_options"`);
    await queryRunner.query(`DROP TABLE "survey_questions"`);
    await queryRunner.query(`DROP TABLE "survey_sections"`);
    await queryRunner.query(`DROP TABLE "survey_dimensions"`);
    await queryRunner.query(`DROP TABLE "survey_versions"`);
    await queryRunner.query(`DROP TABLE "surveys"`);
    await queryRunner.query(`DROP TYPE "public"."survey_questions_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."survey_versions_status_enum"`);
  }
}
