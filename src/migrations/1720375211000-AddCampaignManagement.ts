import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignManagement1720375211000 implements MigrationInterface {
  name = 'AddCampaignManagement1720375211000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_type_enum" AS ENUM('annual', 'semiannual')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_status_enum" AS ENUM('draft', 'active', 'closed', 'archived')`,
    );
    await queryRunner.query(`CREATE TABLE "campaigns" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "name" character varying(255) NOT NULL,
      "description" text,
      "type" "public"."campaigns_type_enum" NOT NULL,
      "status" "public"."campaigns_status_enum" NOT NULL DEFAULT 'draft',
      "survey_version_id" uuid NOT NULL,
      "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "activated_at" TIMESTAMP WITH TIME ZONE,
      "closed_at" TIMESTAMP WITH TIME ZONE,
      "archived_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_campaigns_date_range" CHECK ("ends_at" > "starts_at"),
      CONSTRAINT "PK_campaigns" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_status_dates" ON "campaigns" ("status", "starts_at", "ends_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD CONSTRAINT "FK_campaigns_survey_version" FOREIGN KEY ("survey_version_id") REFERENCES "survey_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP CONSTRAINT "FK_campaigns_survey_version"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_campaigns_status_dates"`);
    await queryRunner.query(`DROP TABLE "campaigns"`);
    await queryRunner.query(`DROP TYPE "public"."campaigns_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."campaigns_type_enum"`);
  }
}
