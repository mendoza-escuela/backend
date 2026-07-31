import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVersionedEvaluationConfiguration1720375218000 implements MigrationInterface {
  name = 'AddVersionedEvaluationConfiguration1720375218000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."evaluation_configurations_status_enum" AS ENUM('draft','active','archived')`,
    );
    await queryRunner.query(`CREATE TABLE "evaluation_configurations" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "version_code" varchar(50) NOT NULL, "name" varchar(160) NOT NULL,
      "description" text, "status" "public"."evaluation_configurations_status_enum" NOT NULL DEFAULT 'draft',
      "mental_health_critical_threshold" numeric(11,8) NOT NULL, "mental_health_max_stars" smallint NOT NULL,
      "metadata" jsonb NOT NULL DEFAULT '{}', "created_by_user_id" uuid, "activated_at" timestamptz,
      "activated_by_user_id" uuid, "archived_at" timestamptz, "archived_by_user_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_evaluation_configurations" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_evaluation_configurations_threshold" CHECK ("mental_health_critical_threshold" >= 0 AND "mental_health_critical_threshold" <= 100),
      CONSTRAINT "CHK_evaluation_configurations_max_stars" CHECK ("mental_health_max_stars" >= 1 AND "mental_health_max_stars" <= 5),
      CONSTRAINT "FK_evaluation_configurations_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_evaluation_configurations_activated_by" FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_evaluation_configurations_archived_by" FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_evaluation_configurations_version_code" ON "evaluation_configurations" ("version_code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_evaluation_configurations_single_active" ON "evaluation_configurations" ("status") WHERE "status" = 'active'`,
    );
    await queryRunner.query(`CREATE TABLE "evaluation_star_ranges" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "configuration_id" uuid NOT NULL, "stars" smallint NOT NULL,
      "lower_bound" numeric(11,8) NOT NULL, "upper_bound" numeric(11,8) NOT NULL, "lower_inclusive" boolean NOT NULL,
      "upper_inclusive" boolean NOT NULL, "order" smallint NOT NULL,
      CONSTRAINT "PK_evaluation_star_ranges" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_evaluation_star_ranges_stars" CHECK ("stars" >= 1 AND "stars" <= 5),
      CONSTRAINT "CHK_evaluation_star_ranges_limits" CHECK ("lower_bound" >= 0 AND "upper_bound" <= 100 AND "lower_bound" <= "upper_bound"),
      CONSTRAINT "FK_evaluation_star_ranges_configuration" FOREIGN KEY ("configuration_id") REFERENCES "evaluation_configurations"("id") ON DELETE CASCADE)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_evaluation_star_ranges_config_stars" ON "evaluation_star_ranges" ("configuration_id", "stars")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_evaluation_star_ranges_config_order" ON "evaluation_star_ranges" ("configuration_id", "order")`,
    );

    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD "base_stars" smallint`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD "evaluation_configuration_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD "evaluation_configuration_version" varchar(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD "evaluation_rule_snapshot" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD "evaluation_alerts" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "CHK_evaluation_results_base_stars" CHECK ("base_stars" IS NULL OR ("base_stars" >= 1 AND "base_stars" <= 5))`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "CHK_evaluation_results_alerts" CHECK (jsonb_typeof("evaluation_alerts") = 'array')`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" ADD CONSTRAINT "FK_evaluation_results_configuration" FOREIGN KEY ("evaluation_configuration_id") REFERENCES "evaluation_configurations"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_evaluation_results_campaign_stars" ON "evaluation_results" ("campaign_id", "stars") WHERE "stars" IS NOT NULL`,
    );

    await queryRunner.query(`WITH inserted AS (
      INSERT INTO "evaluation_configurations" ("version_code","name","description","status","mental_health_critical_threshold","mental_health_max_stars","metadata","activated_at")
      VALUES ('v1.0.0','Configuración inicial aprobada','Rangos y regla de Salud Mental aprobados para la evaluación inicial.','active',33,4,'{"algorithm":"question-average-dynamic-denominator-v1"}',now())
      ON CONFLICT ("version_code") DO NOTHING RETURNING "id"
    ), selected AS (SELECT "id" FROM inserted UNION ALL SELECT "id" FROM "evaluation_configurations" WHERE "version_code"='v1.0.0' LIMIT 1)
    INSERT INTO "evaluation_star_ranges" ("configuration_id","stars","lower_bound","upper_bound","lower_inclusive","upper_inclusive","order")
    SELECT "id", ranges.stars, ranges.low, ranges.high, ranges.low_inc, true, ranges.stars FROM selected CROSS JOIN (VALUES
      (1,0::numeric,20::numeric,true),(2,20,40,false),(3,40,60,false),(4,60,80,false),(5,80,100,false)
    ) AS ranges(stars,low,high,low_inc) ON CONFLICT DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_evaluation_results_campaign_stars"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "FK_evaluation_results_configuration"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "CHK_evaluation_results_alerts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP CONSTRAINT "CHK_evaluation_results_base_stars"`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_results" DROP COLUMN "evaluation_alerts", DROP COLUMN "evaluation_rule_snapshot", DROP COLUMN "evaluation_configuration_version", DROP COLUMN "evaluation_configuration_id", DROP COLUMN "base_stars"`,
    );
    await queryRunner.query(`DROP TABLE "evaluation_star_ranges"`);
    await queryRunner.query(`DROP TABLE "evaluation_configurations"`);
    await queryRunner.query(
      `DROP TYPE "public"."evaluation_configurations_status_enum"`,
    );
  }
}
