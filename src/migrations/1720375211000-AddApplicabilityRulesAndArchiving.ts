import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApplicabilityRulesAndArchiving1720375211000 implements MigrationInterface {
  name = 'AddApplicabilityRulesAndArchiving1720375211000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "survey_applicability_rules" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "question_id" uuid NOT NULL,
      "group_operator" varchar(8) NOT NULL,
      "action" varchar(8) NOT NULL,
      "default_action" varchar(8) NOT NULL,
      "order" integer NOT NULL,
      CONSTRAINT "PK_survey_applicability_rules" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_applicability_rules_group" CHECK ("group_operator" IN ('all', 'any')),
      CONSTRAINT "CHK_applicability_rules_action" CHECK ("action" IN ('show', 'omit')),
      CONSTRAINT "CHK_applicability_rules_default_action" CHECK ("default_action" IN ('show', 'omit')),
      CONSTRAINT "CHK_applicability_rules_order" CHECK ("order" >= 0),
      CONSTRAINT "FK_applicability_rules_question" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_applicability_rules_question_order" ON "survey_applicability_rules" ("question_id", "order")`,
    );
    await queryRunner.query(`CREATE TABLE "survey_applicability_conditions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "rule_id" uuid NOT NULL,
      "feature" varchar(40) NOT NULL,
      "operator" varchar(24) NOT NULL,
      "expected_value" jsonb NOT NULL,
      "order" integer NOT NULL,
      CONSTRAINT "PK_survey_applicability_conditions" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_applicability_conditions_order" CHECK ("order" >= 0),
      CONSTRAINT "FK_applicability_conditions_rule" FOREIGN KEY ("rule_id") REFERENCES "survey_applicability_rules"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_applicability_conditions_rule_order" ON "survey_applicability_conditions" ("rule_id", "order")`,
    );

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "assert_survey_version_mutable"("target_version_id" uuid)
      RETURNS void AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "survey_versions"
          WHERE "id" = "target_version_id" AND "status" <> 'draft'
        ) THEN
          RAISE EXCEPTION 'Sólo las versiones borrador son mutables.'
            USING ERRCODE = '23514';
        END IF;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_published_survey_version"()
      RETURNS trigger AS $$
      BEGIN
        IF OLD."status" = 'archived' THEN
          RAISE EXCEPTION 'Las versiones archivadas son inmutables.'
            USING ERRCODE = '23514';
        END IF;
        IF OLD."status" = 'published' THEN
          IF TG_OP = 'UPDATE'
             AND NEW."status" = 'archived'
             AND (to_jsonb(NEW) - 'status' - 'updated_at') =
                 (to_jsonb(OLD) - 'status' - 'updated_at') THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'Una versión publicada sólo puede archivarse.'
            USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(`CREATE FUNCTION "protect_survey_applicability_rule"()
      RETURNS trigger AS $$
      DECLARE "target_version_id" uuid;
      BEGIN
        SELECT dimension."version_id" INTO "target_version_id"
        FROM "survey_questions" question
        JOIN "survey_sections" section ON section."id" = question."section_id"
        JOIN "survey_dimensions" dimension ON dimension."id" = section."dimension_id"
        WHERE question."id" = COALESCE(NEW."question_id", OLD."question_id");
        PERFORM "assert_survey_version_mutable"("target_version_id");
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE FUNCTION "protect_survey_applicability_condition"()
      RETURNS trigger AS $$
      DECLARE "target_version_id" uuid;
      BEGIN
        SELECT dimension."version_id" INTO "target_version_id"
        FROM "survey_applicability_rules" rule
        JOIN "survey_questions" question ON question."id" = rule."question_id"
        JOIN "survey_sections" section ON section."id" = question."section_id"
        JOIN "survey_dimensions" dimension ON dimension."id" = section."dimension_id"
        WHERE rule."id" = COALESCE(NEW."rule_id", OLD."rule_id");
        PERFORM "assert_survey_version_mutable"("target_version_id");
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_survey_applicability_rules"
      BEFORE INSERT OR UPDATE OR DELETE ON "survey_applicability_rules"
      FOR EACH ROW EXECUTE FUNCTION "protect_survey_applicability_rule"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_survey_applicability_conditions"
      BEFORE INSERT OR UPDATE OR DELETE ON "survey_applicability_conditions"
      FOR EACH ROW EXECUTE FUNCTION "protect_survey_applicability_condition"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_survey_applicability_conditions" ON "survey_applicability_conditions"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_survey_applicability_rules" ON "survey_applicability_rules"`,
    );
    await queryRunner.query(
      `DROP FUNCTION "protect_survey_applicability_condition"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION "protect_survey_applicability_rule"()`,
    );
    await queryRunner.query(`DROP TABLE "survey_applicability_conditions"`);
    await queryRunner.query(`DROP TABLE "survey_applicability_rules"`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "assert_survey_version_mutable"("target_version_id" uuid)
      RETURNS void AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "survey_versions"
          WHERE "id" = "target_version_id" AND "status" = 'published'
        ) THEN
          RAISE EXCEPTION 'Las versiones publicadas son inmutables.'
            USING ERRCODE = '23514';
        END IF;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_published_survey_version"()
      RETURNS trigger AS $$
      BEGIN
        IF OLD."status" = 'published' THEN
          RAISE EXCEPTION 'Las versiones publicadas son inmutables.'
            USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
  }
}
