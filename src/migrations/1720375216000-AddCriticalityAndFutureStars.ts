import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCriticalityAndFutureStars1720375216000 implements MigrationInterface {
  name = 'AddCriticalityAndFutureStars1720375216000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD "stars" smallint`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD "star_rule_version" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD "star_blocking_reasons" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "CHK_evaluation_results_stars" CHECK ("stars" IS NULL OR ("stars" >= 1 AND "stars" <= 5))`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "CHK_evaluation_results_star_rule_version" CHECK ("star_rule_version" IS NULL OR BTRIM("star_rule_version") <> '')`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "CHK_evaluation_results_star_blocking_reasons" CHECK (jsonb_typeof("star_blocking_reasons") = 'array')`,
    );

    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" ADD "is_critical" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" ADD "critical_value" numeric(11,8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" ADD "critical_threshold" numeric(11,8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" ADD "critical_rule_version" character varying(100)`,
    );
    await queryRunner.query(`UPDATE "evaluation_dimension_results"
      SET
        "is_critical" = COALESCE("score" < 33, false),
        "critical_value" = "score",
        "critical_threshold" = 33,
        "critical_rule_version" = 'mental-health-critical-lt-33-v1'
      WHERE "dimension_code" = 'salud_mental'`);
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" ADD CONSTRAINT "CHK_evaluation_dimension_results_criticality" CHECK (
        (
          "is_critical" = false
          AND "critical_value" IS NULL
          AND "critical_threshold" IS NULL
          AND "critical_rule_version" IS NULL
        ) OR (
          "is_critical" = false
          AND "critical_value" IS NULL
          AND "critical_threshold" > 0
          AND "critical_threshold" <= 100
          AND BTRIM("critical_rule_version") <> ''
        ) OR (
          "critical_value" >= 0
          AND "critical_value" <= 100
          AND "critical_threshold" > 0
          AND "critical_threshold" <= 100
          AND BTRIM("critical_rule_version") <> ''
          AND (
            ("is_critical" = true AND "critical_value" < "critical_threshold")
            OR
            ("is_critical" = false AND "critical_value" >= "critical_threshold")
          )
        )
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evaluation_dimension_results_critical" ON "evaluation_dimension_results" ("is_critical", "dimension_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_evaluation_dimension_results_critical"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" DROP CONSTRAINT "CHK_evaluation_dimension_results_criticality"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" DROP COLUMN "critical_rule_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" DROP COLUMN "critical_threshold"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" DROP COLUMN "critical_value"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_dimension_results" DROP COLUMN "is_critical"`,
    );

    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "CHK_evaluation_results_star_blocking_reasons"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "CHK_evaluation_results_star_rule_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "CHK_evaluation_results_stars"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP COLUMN "star_blocking_reasons"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP COLUMN "star_rule_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP COLUMN "stars"`,
    );
  }
}
