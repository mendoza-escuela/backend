import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';
import dataSource from '../data-source';
import { UserRole } from '../../modules/users/entities/user-role.enum';
import { User } from '../../modules/users/entities/user.entity';
import { assertStrongPassword } from '../../modules/auth/utils/password-policy';

/**
 * Crea el administrador inicial configurado sin modificar cuentas existentes.
 *
 * Si ninguna credencial fue configurada, el arranque continúa sin crear una
 * cuenta. Configurar sólo una de ellas es un error para evitar despliegues que
 * aparenten estar inicializados. Una cuenta existente nunca se eleva a admin ni
 * recibe una contraseña nueva de manera implícita.
 */
export async function ensureInitialAdmin(
  initializedDataSource: DataSource,
): Promise<void> {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!email && !password) {
    console.log(
      'Initial administrator credentials are not configured; creation was skipped.',
    );
    return;
  }
  if (!email || !password) {
    throw new Error(
      'INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be configured together.',
    );
  }
  assertStrongPassword(password);

  const repository = initializedDataSource.getRepository(User);
  const existing = await repository
    .createQueryBuilder('user')
    .where('LOWER(user.email) = :email', { email })
    .getOne();
  if (existing) {
    if (existing.role !== UserRole.Admin) {
      throw new Error(
        'INITIAL_ADMIN_EMAIL belongs to a non-admin account; no changes were made.',
      );
    }
    console.log('Initial administrator already exists; no changes were made.');
    return;
  }

  await repository.save(
    repository.create({
      firstName:
        process.env.INITIAL_ADMIN_FIRST_NAME?.trim() || 'Administrador',
      lastName: process.env.INITIAL_ADMIN_LAST_NAME?.trim() || 'Inicial',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: UserRole.Admin,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    }),
  );
  console.log(
    'Initial administrator created. Password change will be required at first login.',
  );
}

async function runStandaloneSeed(): Promise<void> {
  await dataSource.initialize();
  try {
    await ensureInitialAdmin(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  void runStandaloneSeed().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Unable to seed initial administrator.',
    );
    process.exitCode = 1;
  });
}
