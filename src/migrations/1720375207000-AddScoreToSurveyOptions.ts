import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScoreToSurveyOptions1720375207000 implements MigrationInterface {
  name = 'AddScoreToSurveyOptions1720375207000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "survey_options" ADD COLUMN "score" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "survey_options" ADD CONSTRAINT "CHK_survey_options_score_range" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "survey_options" DROP CONSTRAINT "CHK_survey_options_score_range"`,
    );
    await queryRunner.query(`ALTER TABLE "survey_options" DROP COLUMN "score"`);
  }
}
