const { randomBytes } = require('node:crypto');

function runtimePassword(environment = process.env) {
  const configured = environment.EPS_RUNTIME_PASSWORD?.trim();
  if (configured) return configured;
  if (environment.NODE_ENV === 'production') {
    throw new Error(
      'EPS_RUNTIME_PASSWORD must be configured as a production secret.',
    );
  }
  return randomBytes(32).toString('base64url');
}

async function configureRuntimeDatabase(dataSource, password) {
  await dataSource.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eps_runtime') THEN
      CREATE ROLE eps_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eps_audit_retention') THEN
      CREATE ROLE eps_audit_retention NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
  END $$`);
  const [quotedPassword] = await dataSource.query(
    'SELECT quote_literal($1) AS value',
    [password],
  );
  await dataSource.query(
    `ALTER ROLE eps_runtime LOGIN PASSWORD ${quotedPassword.value}`,
  );
  await dataSource.query(
    'GRANT USAGE ON SCHEMA public TO eps_runtime, eps_audit_retention',
  );
  await dataSource.query(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eps_runtime',
  );
  await dataSource.query(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eps_runtime',
  );
  await dataSource.query('REVOKE ALL ON audit_logs FROM eps_runtime');
  await dataSource.query('GRANT SELECT, INSERT ON audit_logs TO eps_runtime');
  await dataSource.query(
    'GRANT SELECT, DELETE ON audit_logs TO eps_audit_retention',
  );
  await dataSource.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
}

function runtimeEnvironment(environment, password) {
  const runtime = { ...environment };
  if (runtime.DATABASE_URL) {
    const databaseUrl = new URL(runtime.DATABASE_URL);
    databaseUrl.username = 'eps_runtime';
    databaseUrl.password = password;
    runtime.DATABASE_URL = databaseUrl.toString();
  } else {
    runtime.DATABASE_USER = 'eps_runtime';
    runtime.DATABASE_PASSWORD = password;
  }
  delete runtime.EPS_RUNTIME_PASSWORD;
  delete runtime.POSTGRES_PASSWORD;
  return runtime;
}

module.exports = {
  configureRuntimeDatabase,
  runtimeEnvironment,
  runtimePassword,
};
