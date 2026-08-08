import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEvaluationResults1720375215000 implements MigrationInterface {
  name = 'AddEvaluationResults1720375215000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "evaluation_results" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "submission_id" uuid NOT NULL,
      "campaign_id" uuid NOT NULL,
      "school_id" uuid NOT NULL,
      "survey_version_id" uuid NOT NULL,
      "general_score" numeric(11,8) NOT NULL,
      "general_numerator" numeric(16,8) NOT NULL,
      "general_denominator" integer NOT NULL,
      "algorithm_version" character varying(100) NOT NULL,
      "snapshot_schema_version" integer NOT NULL,
      "snapshot" jsonb NOT NULL,
      "calculated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "calculated_by_user_id" uuid,
      "calculation_source" character varying(40) NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_evaluation_results_general_score" CHECK ("general_score" >= 0 AND "general_score" <= 100),
      CONSTRAINT "CHK_evaluation_results_general_components" CHECK ("general_numerator" >= 0 AND "general_denominator" > 0 AND "general_numerator" <= ("general_denominator" * 100)),
      CONSTRAINT "CHK_evaluation_results_algorithm_version" CHECK (BTRIM("algorithm_version") <> ''),
      CONSTRAINT "CHK_evaluation_results_snapshot_schema_version" CHECK ("snapshot_schema_version" > 0),
      CONSTRAINT "CHK_evaluation_results_snapshot" CHECK (jsonb_typeof("snapshot") = 'object' AND "snapshot" ?& ARRAY['schemaVersion', 'algorithm', 'result', 'submission', 'school', 'survey']),
      CONSTRAINT "UQ_4889f343fed6c58e8ef29630677" UNIQUE ("submission_id"),
      CONSTRAINT "PK_evaluation_results" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_evaluation_results_campaign" ON "evaluation_results" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evaluation_results_school" ON "evaluation_results" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evaluation_results_survey_version" ON "evaluation_results" ("survey_version_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evaluation_results_calculated_at" ON "evaluation_results" ("calculated_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "FK_evaluation_results_submission" FOREIGN KEY ("submission_id") REFERENCES "survey_submissions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "FK_evaluation_results_campaign" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "FK_evaluation_results_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "FK_evaluation_results_survey_version" FOREIGN KEY ("survey_version_id") REFERENCES "survey_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "FK_evaluation_results_calculated_by" FOREIGN KEY ("calculated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`CREATE TABLE "evaluation_dimension_results" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "result_id" uuid NOT NULL,
      "dimension_id" uuid NOT NULL,
      "dimension_code" character varying(80) NOT NULL,
      "dimension_title" character varying(255) NOT NULL,
      "order" integer NOT NULL,
      "numerator" numeric(16,8) NOT NULL,
      "denominator" integer NOT NULL,
      "score" numeric(11,8),
      CONSTRAINT "CHK_evaluation_dimension_results_order" CHECK ("order" >= 0),
      CONSTRAINT "CHK_evaluation_dimension_results_components" CHECK ("numerator" >= 0 AND "denominator" >= 0 AND "numerator" <= ("denominator" * 100)),
      CONSTRAINT "CHK_evaluation_dimension_results_score" CHECK (("denominator" = 0 AND "score" IS NULL AND "numerator" = 0) OR ("denominator" > 0 AND "score" >= 0 AND "score" <= 100)),
      CONSTRAINT "PK_evaluation_dimension_results" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_evaluation_dimension_results_result_dimension" ON "evaluation_dimension_results" ("result_id", "dimension_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evaluation_dimension_results_dimension" ON "evaluation_dimension_results" ("dimension_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evaluation_dimension_results_dimension_score" ON "evaluation_dimension_results" ("dimension_code", "score")`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" ADD CONSTRAINT "FK_evaluation_dimension_results_result" FOREIGN KEY ("result_id") REFERENCES "evaluation_results"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" ADD CONSTRAINT "FK_evaluation_dimension_results_dimension" FOREIGN KEY ("dimension_id") REFERENCES "survey_dimensions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" DROP CONSTRAINT "FK_evaluation_dimension_results_dimension"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" DROP CONSTRAINT "FK_evaluation_dimension_results_result"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_evaluation_dimension_results_dimension_score"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_evaluation_dimension_results_dimension"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_evaluation_dimension_results_result_dimension"`,
    );
    await queryRunner.query(`DROP TABLE "evaluation_dimension_results"`);

    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "FK_evaluation_results_calculated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "FK_evaluation_results_survey_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "FK_evaluation_results_school"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "FK_evaluation_results_campaign"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "FK_evaluation_results_submission"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_evaluation_results_calculated_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_evaluation_results_survey_version"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_evaluation_results_school"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_evaluation_results_campaign"`,
    );
    await queryRunner.query(`DROP TABLE "evaluation_results"`);
  }
}
