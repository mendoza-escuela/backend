import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hace que toda mutación de contenido tome el mismo lock de fila que usa la
 * publicación. Así, una publicación ve el último contenido confirmado y una
 * escritura que quedó esperando falla si la versión ya dejó de ser borrador.
 */
export class SerializeSurveyVersionMutations1720375224000 implements MigrationInterface {
  name = 'SerializeSurveyVersionMutations1720375224000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "assert_survey_version_mutable"("target_version_id" uuid)
      RETURNS void AS $$
      DECLARE "target_status" text;
      BEGIN
        -- En un ON DELETE CASCADE el ancestro ya tomó este lock y puede no
        -- estar visible cuando se ejecuta el trigger del descendiente.
        IF "target_version_id" IS NULL THEN RETURN; END IF;

        SELECT "status"::text INTO "target_status"
        FROM "survey_versions"
        WHERE "id" = "target_version_id"
        FOR UPDATE;

        IF NOT FOUND THEN RETURN; END IF;
        IF "target_status" <> 'draft' THEN
          RAISE EXCEPTION 'Sólo las versiones borrador son mutables.'
            USING ERRCODE = '23514';
        END IF;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_survey_applicability_rule"()
      RETURNS trigger AS $$
      DECLARE "target_version_id" uuid;
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          SELECT dimension."version_id" INTO "target_version_id"
          FROM "survey_questions" question
          JOIN "survey_sections" section ON section."id" = question."section_id"
          JOIN "survey_dimensions" dimension ON dimension."id" = section."dimension_id"
          WHERE question."id" = OLD."question_id";
          PERFORM "assert_survey_version_mutable"("target_version_id");
        END IF;
        IF TG_OP <> 'DELETE' THEN
          SELECT dimension."version_id" INTO "target_version_id"
          FROM "survey_questions" question
          JOIN "survey_sections" section ON section."id" = question."section_id"
          JOIN "survey_dimensions" dimension ON dimension."id" = section."dimension_id"
          WHERE question."id" = NEW."question_id";
          PERFORM "assert_survey_version_mutable"("target_version_id");
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_survey_applicability_condition"()
      RETURNS trigger AS $$
      DECLARE "target_version_id" uuid;
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          SELECT dimension."version_id" INTO "target_version_id"
          FROM "survey_applicability_rules" rule
          JOIN "survey_questions" question ON question."id" = rule."question_id"
          JOIN "survey_sections" section ON section."id" = question."section_id"
          JOIN "survey_dimensions" dimension ON dimension."id" = section."dimension_id"
          WHERE rule."id" = OLD."rule_id";
          PERFORM "assert_survey_version_mutable"("target_version_id");
        END IF;
        IF TG_OP <> 'DELETE' THEN
          SELECT dimension."version_id" INTO "target_version_id"
          FROM "survey_applicability_rules" rule
          JOIN "survey_questions" question ON question."id" = rule."question_id"
          JOIN "survey_sections" section ON section."id" = question."section_id"
          JOIN "survey_dimensions" dimension ON dimension."id" = section."dimension_id"
          WHERE rule."id" = NEW."rule_id";
          PERFORM "assert_survey_version_mutable"("target_version_id");
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_survey_applicability_rule"()
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

    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_survey_applicability_condition"()
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
  }
}
