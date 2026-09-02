import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega una revisión monotónica a los borradores. El valor por defecto
 * inicializa de forma segura las presentaciones existentes sin reescribir sus
 * respuestas ni alterar su estado.
 */
export class AddSubmissionOptimisticRevision1720375223000 implements MigrationInterface {
  name = 'AddSubmissionOptimisticRevision1720375223000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD "revision" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" ADD CONSTRAINT "CHK_survey_submissions_non_negative_revision" CHECK ("revision" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP CONSTRAINT "CHK_survey_submissions_non_negative_revision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_submissions" DROP COLUMN "revision"`,
    );
  }
}
