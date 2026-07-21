import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSecureAuthentication1720375201000 implements MigrationInterface {
  name = 'AddSecureAuthentication1720375201000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum_new" AS ENUM('admin', 'school')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_new" USING (CASE WHEN "role"::text = 'admin' THEN 'admin' ELSE 'school' END)::"public"."users_role_enum_new"`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum_new" RENAME TO "users_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'school'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "must_change_password" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "last_login_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "failed_login_attempts" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "locked_until" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_users_email_unique"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_email_unique" ON "users" (LOWER("email"))`,
    );

    await queryRunner.query(`CREATE TABLE "schools" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "code" character varying(50) NOT NULL,
      "name" character varying(255) NOT NULL,
      CONSTRAINT "PK_schools_id" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_schools_code_unique" ON "schools" ("code")`,
    );
    await queryRunner.query(`CREATE TABLE "user_schools" (
      "user_id" uuid NOT NULL,
      "school_id" uuid NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_user_schools" PRIMARY KEY ("user_id", "school_id"),
      CONSTRAINT "FK_user_schools_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_user_schools_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_user_schools_school" ON "user_schools" ("school_id")`,
    );

    await queryRunner.query(`CREATE TABLE "auth_sessions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "token_id" uuid NOT NULL,
      "user_id" uuid NOT NULL,
      "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "revoked_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_auth_sessions_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_auth_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_auth_sessions_token_id" ON "auth_sessions" ("token_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_sessions_user_active" ON "auth_sessions" ("user_id", "revoked_at", "expires_at")`,
    );

    await queryRunner.query(`CREATE TABLE "password_reset_tokens" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "token_hash" character varying(64) NOT NULL,
      "user_id" uuid NOT NULL,
      "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "used_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_password_reset_tokens_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_password_reset_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_password_reset_tokens_hash" ON "password_reset_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_password_reset_tokens_user" ON "password_reset_tokens" ("user_id", "used_at", "expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
    await queryRunner.query(`DROP TABLE "auth_sessions"`);
    await queryRunner.query(`DROP TABLE "user_schools"`);
    await queryRunner.query(`DROP TABLE "schools"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_email_unique"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_email_unique" ON "users" ("email")`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "locked_until"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "failed_login_attempts"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_login_at"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "must_change_password"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum_old" AS ENUM('admin', 'user')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_old" USING (CASE WHEN "role"::text = 'admin' THEN 'admin' ELSE 'user' END)::"public"."users_role_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum_old" RENAME TO "users_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'`,
    );
  }
}
