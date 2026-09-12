const assert = require('node:assert/strict');
const test = require('node:test');
const {
  configureRuntimeDatabase,
  runtimeEnvironment,
  runtimePassword,
} = require('./configure-runtime-database.cjs');

test('genera una credencial temporal en desarrollo', () => {
  const password = runtimePassword({ NODE_ENV: 'development' });
  assert.ok(password.length >= 32);
});

test('exige una credencial administrada en producción', () => {
  assert.throws(
    () => runtimePassword({ NODE_ENV: 'production' }),
    /EPS_RUNTIME_PASSWORD/,
  );
});

test('entrega a la API solamente la conexión restringida', () => {
  const environment = runtimeEnvironment(
    {
      DATABASE_URL: 'postgresql://owner:owner-secret@localhost:5432/app',
      EPS_RUNTIME_PASSWORD: 'runtime-secret',
      POSTGRES_PASSWORD: 'owner-secret',
    },
    'runtime-secret',
  );
  const url = new URL(environment.DATABASE_URL);
  assert.equal(url.username, 'eps_runtime');
  assert.equal(url.password, 'runtime-secret');
  assert.equal(environment.EPS_RUNTIME_PASSWORD, undefined);
  assert.equal(environment.POSTGRES_PASSWORD, undefined);
  assert.ok(!environment.DATABASE_URL.includes('owner-secret'));
});

test('configura permisos usando una contraseña escapada por PostgreSQL', async () => {
  const statements = [];
  const dataSource = {
    query: async (sql, parameters) => {
      statements.push({ sql, parameters });
      return sql.startsWith('SELECT quote_literal')
        ? [{ value: "'safe-runtime-secret'" }]
        : [];
    },
  };
  await configureRuntimeDatabase(dataSource, 'unsafe-input');
  assert.ok(
    statements.some(({ sql }) =>
      sql.includes("ALTER ROLE eps_runtime LOGIN PASSWORD 'safe-runtime-secret'"),
    ),
  );
  assert.ok(
    statements.some(({ sql }) =>
      sql.includes('GRANT SELECT, INSERT ON audit_logs TO eps_runtime'),
    ),
  );
});
