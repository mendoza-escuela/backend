import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignTrackingIndexes1720375217000 implements MigrationInterface {
  name = 'AddCampaignTrackingIndexes1720375217000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_submissions_campaign_last_saved" ON "survey_submissions" ("campaign_id", "last_saved_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_submissions_campaign_submitted" ON "survey_submissions" ("campaign_id", "submitted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schools_created_at_id" ON "schools" ("created_at", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_schools_created_at_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_survey_submissions_campaign_submitted"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_survey_submissions_campaign_last_saved"`,
    );
  }
}
