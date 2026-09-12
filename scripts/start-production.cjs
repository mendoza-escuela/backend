const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const migrationLockId = 748_330_021;

async function startProduction() {
  const dataSourceModule = require(
    path.join(projectRoot, 'dist', 'database', 'data-source.js'),
  );
  const dataSource = dataSourceModule.default;
  const { ensureInitialAdmin } = require(
    path.join(
      projectRoot,
      'dist',
      'database',
      'seeds',
      'seed-initial-admin.js',
    ),
  );

  console.log('Waiting for the database migration lock...');
  await dataSource.initialize();

  try {
    await dataSource.query('SELECT pg_advisory_lock($1)', [migrationLockId]);
    try {
      console.log('Running pending database migrations...');
      const executedMigrations = process.env.MIGRATIONS_ON_START === 'false'
        ? []
        : await dataSource.runMigrations();
      if (process.env.MIGRATIONS_ON_START === 'false' && await dataSource.showMigrations()) {
        throw new Error('Pending migrations must be applied by the release job.');
      }
      console.log(
        executedMigrations.length === 0
          ? 'No migrations are pending.'
          : `${executedMigrations.length} migration(s) executed successfully.`,
      );
      console.log('Ensuring the initial administrator exists...');
      await ensureInitialAdmin(dataSource);
    } finally {
      await dataSource.query('SELECT pg_advisory_unlock($1)', [
        migrationLockId,
      ]);
    }
  } finally {
    await dataSource.destroy();
  }

  console.log('Database schema is up to date. Starting the API...');
  require(path.join(projectRoot, 'dist', 'main.js'));
}

startProduction().catch(() => {
  console.error(
    'Production initialization failed. The API will not start.',
  );
  process.exit(1);
});
