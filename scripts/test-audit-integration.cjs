const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');
const { readFileSync } = require('node:fs');

// PostgreSQL efímero: nunca toma DATABASE_URL ni credenciales del entorno real.
const container = `eps-audit-test-${randomUUID()}`;
const password = randomBytes(24).toString('hex');
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, ...options });
async function run() {
  let created = false;
  try {
    docker(['run', '-d', '--name', container, '--label', 'eps.task=audit-test', '-e', 'POSTGRES_PASSWORD', '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { env: { ...process.env, POSTGRES_PASSWORD: password } });
    created = true;
    const ports = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', container]));
    const port = ports['5432/tcp'][0].HostPort;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
    }
    const check = spawnSync(process.execPath, ['node_modules/jest/bin/jest.js', '--config', 'test/jest-e2e.json', '--runInBand', 'audit-protection'], {
      cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
      env: { ...process.env, TEST_AUDIT_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres` },
    });
    process.exitCode = check.status ?? 1;
    if (check.status === 0) {
      docker(['exec', '-i', '-e', 'EPS_RUNTIME_PASSWORD', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-f', '/dev/stdin'], {
        input: readFileSync(path.join(__dirname, '../operations/configure-audit-roles.sql'), 'utf8'),
        env: { ...process.env, EPS_RUNTIME_PASSWORD: randomBytes(24).toString('hex') },
      });
      const permissions = docker(['exec', container, 'psql', '-U', 'eps_runtime', '-d', 'postgres', '-tAc',
        "SELECT has_table_privilege(current_user,'audit_logs','INSERT'),has_table_privilege(current_user,'audit_logs','UPDATE'),has_table_privilege(current_user,'audit_logs','DELETE'),has_table_privilege(current_user,'audit_logs','TRUNCATE')"]);
      if (permissions.trim() !== 't|f|f|f') throw new Error('Invalid runtime audit privileges');
      console.log('Asignación de roles verificada: runtime puede insertar, pero no modificar ni eliminar auditoría.');
    }
  } finally {
    if (created) docker(['rm', '-f', container], { stdio: 'ignore' });
  }
}
run().catch(() => { console.error('No se pudo ejecutar la prueba aislada de auditoría.'); process.exitCode = 1; });
