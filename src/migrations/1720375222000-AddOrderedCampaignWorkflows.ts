import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderedCampaignWorkflows1720375222000 implements MigrationInterface {
  name = 'AddOrderedCampaignWorkflows1720375222000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD "workflow_cycle" character varying(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD "sequence_order" smallint`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD CONSTRAINT "CHK_campaigns_workflow_pair" CHECK (("workflow_cycle" IS NULL AND "sequence_order" IS NULL) OR ("workflow_cycle" IS NOT NULL AND "sequence_order" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD CONSTRAINT "CHK_campaigns_sequence_order_positive" CHECK ("sequence_order" IS NULL OR "sequence_order" > 0)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_workflow_order" ON "campaigns" ("workflow_cycle", "sequence_order")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_campaigns_workflow_order_ci" ON "campaigns" (LOWER("workflow_cycle"), "sequence_order") WHERE "workflow_cycle" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_campaigns_workflow_order_ci"`);
    await queryRunner.query(`DROP INDEX "IDX_campaigns_workflow_order"`);
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP CONSTRAINT "CHK_campaigns_sequence_order_positive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP CONSTRAINT "CHK_campaigns_workflow_pair"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN "sequence_order"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN "workflow_cycle"`,
    );
  }
}
