import { MigrationInterface, QueryRunner } from 'typeorm';

/** No elimina ni reescribe eventos históricos. La purga requiere un rol separado. */
export class ProtectAuditLogs1720375230000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audit_logs
      ADD COLUMN request_id uuid,
      ADD COLUMN source_ip varchar(45),
      ADD COLUMN service varchar(40) NOT NULL DEFAULT 'backend',
      ADD COLUMN severity varchar(10) NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'error'))`);
    await queryRunner.query(
      'CREATE INDEX idx_audit_created_id ON audit_logs (created_at DESC, id DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_audit_action_created ON audit_logs (action, created_at DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_audit_request ON audit_logs (request_id)',
    );
    // La identidad del actor debe sobrevivir incluso a la eliminación de su cuenta.
    await queryRunner.query(`DO $$ DECLARE constraint_name text; BEGIN
      FOR constraint_name IN SELECT conname FROM pg_constraint
        WHERE conrelid = 'audit_logs'::regclass AND contype = 'f'
      LOOP EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', constraint_name); END LOOP;
    END $$`);
    await queryRunner.query(`CREATE FUNCTION protect_audit_logs() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP = 'DELETE' AND current_user = 'eps_audit_retention'
          AND OLD.created_at < clock_timestamp() - interval '365 days' THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Audit logs are append-only; retention requires a dedicated maintenance role'
          USING ERRCODE = '42501';
      END $$`);
    await queryRunner.query(`CREATE TRIGGER audit_logs_immutable
      BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION protect_audit_logs()`);
    await queryRunner.query(`CREATE TRIGGER audit_logs_no_truncate
      BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION protect_audit_logs()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER audit_logs_no_truncate ON audit_logs',
    );
    await queryRunner.query('DROP TRIGGER audit_logs_immutable ON audit_logs');
    await queryRunner.query('DROP FUNCTION protect_audit_logs()');
    // Conserva referencias históricas sin usuario; NOT VALID evita borrar esos eventos.
    await queryRunner.query(`ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_actor
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID`);
    await queryRunner.query('DROP INDEX idx_audit_request');
    await queryRunner.query('DROP INDEX idx_audit_action_created');
    await queryRunner.query('DROP INDEX idx_audit_created_id');
    await queryRunner.query(
      'ALTER TABLE audit_logs DROP COLUMN request_id, DROP COLUMN source_ip, DROP COLUMN service, DROP COLUMN severity',
    );
  }
}
