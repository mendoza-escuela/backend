-- Ejecutar con psql como propietario/migrador, después de las migraciones.
-- La contraseña se toma del entorno del proceso psql, nunca del repositorio.
\set ON_ERROR_STOP on
\getenv runtime_password EPS_RUNTIME_PASSWORD
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eps_runtime') THEN
    CREATE ROLE eps_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eps_audit_retention') THEN
    CREATE ROLE eps_audit_retention NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
ALTER ROLE eps_runtime LOGIN PASSWORD :'runtime_password';
GRANT USAGE ON SCHEMA public TO eps_runtime, eps_audit_retention;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eps_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eps_runtime;
REVOKE ALL ON audit_logs FROM eps_runtime;
GRANT SELECT, INSERT ON audit_logs TO eps_runtime;
GRANT SELECT, DELETE ON audit_logs TO eps_audit_retention;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- No se concede el rol de mantenimiento ni el de propietario a eps_runtime.
COMMIT;
