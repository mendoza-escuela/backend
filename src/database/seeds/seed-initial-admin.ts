import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import dataSource from '../data-source';
import { UserRole } from '../../modules/users/entities/user-role.enum';
import { User } from '../../modules/users/entities/user.entity';
import { assertStrongPassword } from '../../modules/auth/utils/password-policy';

async function seedInitialAdmin(): Promise<void> {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error(
      'INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are required.',
    );
  assertStrongPassword(password);

  await dataSource.initialize();
  const repository = dataSource.getRepository(User);
  const existing = await repository
    .createQueryBuilder('user')
    .where('LOWER(user.email) = :email', { email })
    .getOne();
  if (existing) {
    console.log('Initial administrator already exists; no changes were made.');
    return;
  }

  await repository.save(
    repository.create({
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

seedInitialAdmin()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Unable to seed initial administrator.',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });
