import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mantiene inmutables las decisiones de presentaciones enviadas, salvo dentro
 * de una transacción que habilite explícitamente la reparación histórica.
 * El ajuste es local a la transacción y vuelve a `off` automáticamente.
 */
export class AllowAuditedApplicabilityDataRepair1720375220000 implements MigrationInterface {
  name = 'AllowAuditedApplicabilityDataRepair1720375220000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_submitted_applicability"()
      RETURNS trigger AS $$
      DECLARE "target_submission_id" uuid;
      BEGIN
        "target_submission_id" := CASE WHEN TG_OP = 'DELETE' THEN OLD."submission_id" ELSE NEW."submission_id" END;
        IF EXISTS (
          SELECT 1 FROM "survey_submissions"
          WHERE "id" = "target_submission_id" AND "status" = 'submitted'
        ) AND current_setting('ops.allow_kiosk_applicability_repair', true) IS DISTINCT FROM 'on' THEN
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "protect_submitted_applicability"()
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
  }
}
