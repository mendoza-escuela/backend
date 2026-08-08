import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubmissionApplicabilityDecisions1720375214000 implements MigrationInterface {
  name = 'AddSubmissionApplicabilityDecisions1720375214000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "submission_question_applicability" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "submission_id" uuid NOT NULL,
      "question_id" uuid NOT NULL,
      "survey_version_id" uuid NOT NULL,
      "applied_rule_id" uuid,
      "status" character varying(16) NOT NULL,
      "reason_code" character varying(60) NOT NULL,
      "reason_description" text NOT NULL,
      "missing_features" jsonb NOT NULL DEFAULT '[]',
      "relevant_school_facts" jsonb NOT NULL DEFAULT '{}',
      "evaluated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT "CHK_submission_question_applicability_status" CHECK ("status" IN ('applicable', 'excluded', 'incomplete')),
      CONSTRAINT "CHK_submission_question_applicability_missing_features" CHECK (jsonb_typeof("missing_features") = 'array'),
      CONSTRAINT "CHK_submission_question_applicability_relevant_facts" CHECK (jsonb_typeof("relevant_school_facts") = 'object'),
      CONSTRAINT "PK_submission_question_applicability" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_submission_question_applicability_submission_question" ON "submission_question_applicability" ("submission_id", "question_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_submission_question_applicability_status" ON "submission_question_applicability" ("submission_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission_question_applicability" ADD CONSTRAINT "FK_submission_question_applicability_submission" FOREIGN KEY ("submission_id") REFERENCES "survey_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission_question_applicability" ADD CONSTRAINT "FK_submission_question_applicability_question" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission_question_applicability" ADD CONSTRAINT "FK_submission_question_applicability_version" FOREIGN KEY ("survey_version_id") REFERENCES "survey_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission_question_applicability" ADD CONSTRAINT "FK_submission_question_applicability_rule" FOREIGN KEY ("applied_rule_id") REFERENCES "survey_applicability_rules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE FUNCTION "protect_submitted_applicability"()
      RETURNS trigger AS $$
      DECLARE "target_submission_id" uuid;
      BEGIN
        "target_submission_id" := CASE WHEN TG_OP = 'DELETE' THEN OLD."submission_id" ELSE NEW."submission_id" END;
        IF EXISTS (
          SELECT 1 FROM "survey_submissions"
          WHERE "id" = "target_submission_id" AND "status" = 'submitted'
        ) THEN
          RAISE EXCEPTION 'La aplicabilidad de una presentación enviada es inmutable.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND (
          OLD."submission_id" IS DISTINCT FROM NEW."submission_id"
          OR OLD."question_id" IS DISTINCT FROM NEW."question_id"
          OR OLD."survey_version_id" IS DISTINCT FROM NEW."survey_version_id"
        ) THEN
          RAISE EXCEPTION 'No se puede mover una decisión de aplicabilidad.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_submitted_applicability"
      BEFORE INSERT OR UPDATE OR DELETE ON "submission_question_applicability"
      FOR EACH ROW EXECUTE FUNCTION "protect_submitted_applicability"()`);
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_submitted_applicability" ON "submission_question_applicability"`,
    );
    await queryRunner.query(
      `DROP FUNCTION "protect_submitted_applicability"()`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission_question_applicability" DROP CONSTRAINT "FK_submission_question_applicability_rule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission_question_applicability" DROP CONSTRAINT "FK_submission_question_applicability_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission_question_applicability" DROP CONSTRAINT "FK_submission_question_applicability_question"`,
    );
    await queryRunner.query(
      `ALTER TABLE "submission_question_applicability" DROP CONSTRAINT "FK_submission_question_applicability_submission"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_submission_question_applicability_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_submission_question_applicability_submission_question"`,
    );
    await queryRunner.query(`DROP TABLE "submission_question_applicability"`);
  }
}
