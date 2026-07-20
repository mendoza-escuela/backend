import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserManagement1720375202000 implements MigrationInterface {
  name = 'AddUserManagement1720375202000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "first_name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "last_name" character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "first_name" = 'Administrador', "last_name" = 'Inicial' WHERE "first_name" IS NULL OR "last_name" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "first_name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "last_name" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_role_active" ON "users" ("role", "is_active")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_name_search" ON "users" (LOWER("last_name"), LOWER("first_name"))`,
    );

    await queryRunner.query(`CREATE TABLE "audit_logs" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "actor_user_id" uuid,
      "action" character varying(80) NOT NULL,
      "entity_type" character varying(80) NOT NULL,
      "entity_id" uuid,
      "changes" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_audit_logs_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_actor" ON "audit_logs" ("actor_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_entity" ON "audit_logs" ("entity_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_name_search"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_role_active"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "first_name"`);
  }
}
