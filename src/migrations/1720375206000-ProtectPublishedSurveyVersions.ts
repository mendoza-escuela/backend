import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProtectPublishedSurveyVersions1720375206000 implements MigrationInterface {
  name = 'ProtectPublishedSurveyVersions1720375206000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE FUNCTION "assert_survey_version_mutable"("target_version_id" uuid)
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

    await queryRunner.query(`CREATE FUNCTION "protect_published_survey_version"()
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

    await queryRunner.query(`CREATE FUNCTION "protect_published_survey_dimension"()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          PERFORM "assert_survey_version_mutable"(OLD."version_id");
        END IF;
        IF TG_OP <> 'DELETE' THEN
          PERFORM "assert_survey_version_mutable"(NEW."version_id");
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(`CREATE FUNCTION "protect_published_survey_section"()
      RETURNS trigger AS $$
      DECLARE "target_version_id" uuid;
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          SELECT "version_id" INTO "target_version_id" FROM "survey_dimensions" WHERE "id" = OLD."dimension_id";
          PERFORM "assert_survey_version_mutable"("target_version_id");
        END IF;
        IF TG_OP <> 'DELETE' THEN
          SELECT "version_id" INTO "target_version_id" FROM "survey_dimensions" WHERE "id" = NEW."dimension_id";
          PERFORM "assert_survey_version_mutable"("target_version_id");
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(`CREATE FUNCTION "protect_published_survey_question"()
      RETURNS trigger AS $$
      DECLARE "target_version_id" uuid;
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          SELECT dimension."version_id" INTO "target_version_id"
          FROM "survey_sections" section
          JOIN "survey_dimensions" dimension ON dimension."id" = section."dimension_id"
          WHERE section."id" = OLD."section_id";
          PERFORM "assert_survey_version_mutable"("target_version_id");
        END IF;
        IF TG_OP <> 'DELETE' THEN
          SELECT dimension."version_id" INTO "target_version_id"
          FROM "survey_sections" section
          JOIN "survey_dimensions" dimension ON dimension."id" = section."dimension_id"
          WHERE section."id" = NEW."section_id";
          PERFORM "assert_survey_version_mutable"("target_version_id");
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);

    await queryRunner.query(`CREATE FUNCTION "protect_published_survey_option"()
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

    await queryRunner.query(`CREATE TRIGGER "TRG_protect_published_survey_versions"
      BEFORE UPDATE OR DELETE ON "survey_versions"
      FOR EACH ROW EXECUTE FUNCTION "protect_published_survey_version"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_published_survey_dimensions"
      BEFORE INSERT OR UPDATE OR DELETE ON "survey_dimensions"
      FOR EACH ROW EXECUTE FUNCTION "protect_published_survey_dimension"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_published_survey_sections"
      BEFORE INSERT OR UPDATE OR DELETE ON "survey_sections"
      FOR EACH ROW EXECUTE FUNCTION "protect_published_survey_section"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_published_survey_questions"
      BEFORE INSERT OR UPDATE OR DELETE ON "survey_questions"
      FOR EACH ROW EXECUTE FUNCTION "protect_published_survey_question"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_protect_published_survey_options"
      BEFORE INSERT OR UPDATE OR DELETE ON "survey_options"
      FOR EACH ROW EXECUTE FUNCTION "protect_published_survey_option"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_published_survey_options" ON "survey_options"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_published_survey_questions" ON "survey_questions"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_published_survey_sections" ON "survey_sections"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_published_survey_dimensions" ON "survey_dimensions"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_protect_published_survey_versions" ON "survey_versions"`,
    );
    await queryRunner.query(
      `DROP FUNCTION "protect_published_survey_option"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION "protect_published_survey_question"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION "protect_published_survey_section"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION "protect_published_survey_dimension"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION "protect_published_survey_version"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION "assert_survey_version_mutable"(uuid)`,
    );
  }
}
