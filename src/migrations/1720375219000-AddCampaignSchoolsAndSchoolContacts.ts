import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignSchoolsAndSchoolContacts1720375219000 implements MigrationInterface {
  name = 'AddCampaignSchoolsAndSchoolContacts1720375219000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."campaign_schools_assignment_source_enum" AS ENUM('manual', 'filter', 'bulk')`,
    );
    await queryRunner.query(`CREATE TABLE "campaign_schools" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "campaign_id" uuid NOT NULL,
      "school_id" uuid NOT NULL,
      "assigned_by_user_id" uuid,
      "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "assignment_source" "public"."campaign_schools_assignment_source_enum" NOT NULL,
      "removed_at" TIMESTAMP WITH TIME ZONE,
      "removal_reason" character varying(500),
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_campaign_schools" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_campaign_schools_campaign_school" ON "campaign_schools" ("campaign_id", "school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_schools_campaign_current" ON "campaign_schools" ("campaign_id", "removed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_schools_school_current" ON "campaign_schools" ("school_id", "removed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_schools_campaign_assigned" ON "campaign_schools" ("campaign_id", "assigned_at", "school_id") WHERE "removed_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_schools" ADD CONSTRAINT "FK_campaign_schools_campaign" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_schools" ADD CONSTRAINT "FK_campaign_schools_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_schools" ADD CONSTRAINT "FK_campaign_schools_assigned_by" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Preserva el universo que usaba el seguimiento anterior para campañas ya creadas.
    await queryRunner.query(`INSERT INTO "campaign_schools" (
      "campaign_id", "school_id", "assigned_by_user_id", "assigned_at",
      "assignment_source", "removed_at", "removal_reason"
    )
    SELECT campaign."id", school."id", NULL, campaign."created_at", 'bulk', NULL, NULL
    FROM "campaigns" campaign
    CROSS JOIN "schools" school
    WHERE school."created_at" <= CASE
      WHEN campaign."closed_at" IS NOT NULL
        AND campaign."closed_at" < campaign."ends_at"
        THEN campaign."closed_at"
      ELSE campaign."ends_at"
    END
       OR EXISTS (
         SELECT 1 FROM "survey_submissions" submission
         WHERE submission."campaign_id" = campaign."id"
           AND submission."school_id" = school."id"
       )
    ON CONFLICT ("campaign_id", "school_id") DO NOTHING`);

    await queryRunner.query(
      `CREATE TYPE "public"."school_contacts_type_enum" AS ENUM('RESPONDENT', 'HEALTH_PROMOTION')`,
    );
    await queryRunner.query(`CREATE TABLE "school_contacts" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "school_id" uuid NOT NULL,
      "type" "public"."school_contacts_type_enum" NOT NULL,
      "first_name" character varying(100) NOT NULL,
      "last_name" character varying(100) NOT NULL,
      "position" character varying(160),
      "phone" character varying(40),
      "email" character varying(255),
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_school_contacts" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_school_contacts_school_type" ON "school_contacts" ("school_id", "type")`,
    );
    await queryRunner.query(
      `ALTER TABLE "school_contacts" ADD CONSTRAINT "FK_school_contacts_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`INSERT INTO "school_contacts" (
      "school_id", "type", "first_name", "last_name", "position", "phone", "email"
    )
    SELECT "id", 'RESPONDENT', "referent_first_name", "referent_last_name",
      NULL, "referent_phone", "referent_email"
    FROM "schools"
    WHERE BTRIM("referent_first_name") <> '' AND BTRIM("referent_last_name") <> ''
    ON CONFLICT ("school_id", "type") DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "school_contacts" DROP CONSTRAINT "FK_school_contacts_school"`,
    );
    await queryRunner.query(`DROP TABLE "school_contacts"`);
    await queryRunner.query(`DROP TYPE "public"."school_contacts_type_enum"`);
    await queryRunner.query(
      `ALTER TABLE "campaign_schools" DROP CONSTRAINT "FK_campaign_schools_assigned_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_schools" DROP CONSTRAINT "FK_campaign_schools_school"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_schools" DROP CONSTRAINT "FK_campaign_schools_campaign"`,
    );
    await queryRunner.query(`DROP TABLE "campaign_schools"`);
    await queryRunner.query(
      `DROP TYPE "public"."campaign_schools_assignment_source_enum"`,
    );
  }
}
