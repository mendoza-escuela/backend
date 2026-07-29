import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSurveySubmissions1720375212000 implements MigrationInterface {
  name = 'AddSurveySubmissions1720375212000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."survey_submissions_status_enum" AS ENUM('draft', 'submitted')`,
    );
    await queryRunner.query(`CREATE TABLE "survey_submissions" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "campaign_id" uuid NOT NULL,
      "school_id" uuid NOT NULL,
      "survey_version_id" uuid NOT NULL,
      "original_respondent_id" uuid,
      "original_respondent_snapshot" jsonb NOT NULL,
      "status" "public"."survey_submissions_status_enum" NOT NULL DEFAULT 'draft',
      "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "last_saved_at" TIMESTAMP WITH TIME ZONE,
      "submitted_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_survey_submissions_respondent_snapshot" CHECK (jsonb_typeof("original_respondent_snapshot") = 'object'),
      CONSTRAINT "CHK_survey_submissions_submitted_at" CHECK (("status" = 'submitted' AND "submitted_at" IS NOT NULL) OR ("status" = 'draft' AND "submitted_at" IS NULL)),
      CONSTRAINT "PK_survey_submissions" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_submissions_school_campaign" ON "survey_submissions" ("school_id", "campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_submissions_campaign_status" ON "survey_submissions" ("campaign_id", "status")`,
    );
    await queryRunner.query(`CREATE TABLE "survey_answers" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "submission_id" uuid NOT NULL,
      "question_id" uuid NOT NULL,
      "option_id" uuid,
      "answer_value" jsonb,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_survey_answers" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_answers_submission_question" ON "survey_answers" ("submission_id", "question_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD CONSTRAINT "FK_survey_submissions_campaign" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD CONSTRAINT "FK_survey_submissions_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD CONSTRAINT "FK_survey_submissions_version" FOREIGN KEY ("survey_version_id") REFERENCES "survey_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD CONSTRAINT "FK_survey_submissions_respondent" FOREIGN KEY ("original_respondent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_answers" ADD CONSTRAINT "FK_survey_answers_submission" FOREIGN KEY ("submission_id") REFERENCES "survey_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_answers" ADD CONSTRAINT "FK_survey_answers_question" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_answers" ADD CONSTRAINT "FK_survey_answers_option" FOREIGN KEY ("option_id") REFERENCES "survey_options"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`CREATE FUNCTION "protect_submission_identity"()
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
    await queryRunner.query(`CREATE FUNCTION "protect_submitted_answer"()
      RETURNS trigger AS $$
      DECLARE "target_submission_id" uuid;
      BEGIN
        "target_submission_id" := CASE WHEN TG_OP = 'DELETE' THEN OLD."submission_id" ELSE NEW."submission_id" END;
        IF EXISTS (
          SELECT 1 FROM "survey_submissions"
          WHERE "id" = "target_submission_id" AND "status" = 'submitted'
        ) THEN
          RAISE EXCEPTION 'Las respuestas enviadas son inmutables.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND OLD."submission_id" IS DISTINCT FROM NEW."submission_id" THEN
          RAISE EXCEPTION 'No se puede mover una respuesta entre presentaciones.' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_submission_identity"
      BEFORE UPDATE OR DELETE ON "survey_submissions"
      FOR EACH ROW EXECUTE FUNCTION "protect_submission_identity"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_submitted_answers"
      BEFORE INSERT OR UPDATE OR DELETE ON "survey_answers"
      FOR EACH ROW EXECUTE FUNCTION "protect_submitted_answer"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_submitted_answers" ON "survey_answers"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_submission_identity" ON "survey_submissions"`,
    );
    await queryRunner.query(`DROP FUNCTION "protect_submitted_answer"()`);
    await queryRunner.query(`DROP FUNCTION "protect_submission_identity"()`);
    await queryRunner.query(
      `ALTER TABLE "survey_answers" DROP CONSTRAINT "FK_survey_answers_option"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_answers" DROP CONSTRAINT "FK_survey_answers_question"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_answers" DROP CONSTRAINT "FK_survey_answers_submission"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP CONSTRAINT "FK_survey_submissions_respondent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP CONSTRAINT "FK_survey_submissions_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP CONSTRAINT "FK_survey_submissions_school"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP CONSTRAINT "FK_survey_submissions_campaign"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_survey_answers_submission_question"`,
    );
    await queryRunner.query(`DROP TABLE "survey_answers"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_survey_submissions_campaign_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_survey_submissions_school_campaign"`,
    );
    await queryRunner.query(`DROP TABLE "survey_submissions"`);
    await queryRunner.query(
      `DROP TYPE "public"."survey_submissions_status_enum"`,
    );
  }
}
