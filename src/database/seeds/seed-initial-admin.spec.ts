import * as bcrypt from 'bcrypt';
import type { DataSource, Repository } from 'typeorm';
import { UserRole } from '../../modules/users/entities/user-role.enum';
import { User } from '../../modules/users/entities/user.entity';
import { ensureInitialAdmin } from './seed-initial-admin';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('secure-password-hash'),
}));

describe('ensureInitialAdmin', () => {
  const originalEnvironment = process.env;
  let repository: jest.Mocked<Pick<Repository<User>, 'create' | 'save'>> & {
    createQueryBuilder: jest.Mock;
  };
  let getRepository: jest.Mock;
  let dataSource: DataSource;

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env.INITIAL_ADMIN_EMAIL;
    delete process.env.INITIAL_ADMIN_PASSWORD;
    repository = {
      create: jest.fn((user: Partial<User>) => user as User),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    getRepository = jest.fn().mockReturnValue(repository);
    dataSource = { getRepository } as unknown as DataSource;
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  it('omite la creación cuando no se configuraron credenciales', async () => {
    await ensureInitialAdmin(dataSource);

    expect(getRepository).not.toHaveBeenCalled();
  });

  it('rechaza una configuración incompleta', async () => {
    process.env.INITIAL_ADMIN_EMAIL = 'admin@example.com';

    await expect(ensureInitialAdmin(dataSource)).rejects.toThrow(
      /must be configured together/,
    );
  });

  it('no modifica un administrador existente', async () => {
    configureCredentials();
    mockExistingUser({ role: UserRole.Admin });

    await ensureInitialAdmin(dataSource);

    expect(repository.save).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('no eleva automáticamente una cuenta existente', async () => {
    configureCredentials();
    mockExistingUser({ role: UserRole.School });

    await expect(ensureInitialAdmin(dataSource)).rejects.toThrow(
      /belongs to a non-admin account/,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('crea un administrador nuevo y exige cambiar su contraseña', async () => {
    configureCredentials();
    mockExistingUser(null);

    await ensureInitialAdmin(dataSource);

    expect(bcrypt.hash).toHaveBeenCalledWith('StrongPassword123!', 12);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@example.com',
        passwordHash: 'secure-password-hash',
        role: UserRole.Admin,
        isActive: true,
        mustChangePassword: true,
      }),
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  function configureCredentials() {
    process.env.INITIAL_ADMIN_EMAIL = ' Admin@Example.com ';
    process.env.INITIAL_ADMIN_PASSWORD = 'StrongPassword123!';
  }

  function mockExistingUser(existingUser: Pick<User, 'role'> | null) {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(existingUser),
    };
    repository.createQueryBuilder.mockReturnValue(queryBuilder);
  }
});
