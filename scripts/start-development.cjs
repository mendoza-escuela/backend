require('dotenv').config();
require('ts-node/register');
require('tsconfig-paths/register');

const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  configureRuntimeDatabase,
  runtimeEnvironment,
  runtimePassword,
} = require('./configure-runtime-database.cjs');

const projectRoot = path.resolve(__dirname, '..');

async function startDevelopment() {
  const dataSource = require(
    path.join(projectRoot, 'src', 'database', 'data-source.ts'),
  ).default;
  const password = runtimePassword();

  console.log('Preparando la base de datos de desarrollo...');
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
    await configureRuntimeDatabase(dataSource, password);
  } finally {
    await dataSource.destroy();
  }

  console.log('Permisos preparados. Iniciando la aplicación...');
  const nestCli = path.join(
    projectRoot,
    'node_modules',
    '@nestjs',
    'cli',
    'bin',
    'nest.js',
  );
  const child = spawn(process.execPath, [nestCli, 'start', ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: runtimeEnvironment(process.env, password),
    stdio: 'inherit',
  });
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

startDevelopment().catch((error) => {
  console.error(
    error instanceof Error
      ? `No se pudo preparar el entorno de desarrollo: ${error.message}`
      : 'No se pudo preparar el entorno de desarrollo.',
  );
  process.exit(1);
});
