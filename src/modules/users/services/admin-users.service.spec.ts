import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { UserRole } from '../entities/user-role.enum';
import { User } from '../entities/user.entity';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  it('pagina usuarios en base de datos y selecciona sólo campos del listado', async () => {
    const users = [
      {
        id: 'user-id',
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
        role: UserRole.Admin,
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        userSchools: [],
      },
    ] as User[];
    const builder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([users, 61]),
    };
    const dataSource = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => builder),
      })),
    } as unknown as DataSource;

    const response = await new AdminUsersService(dataSource).list({
      search: 'ana',
      page: 3,
      limit: 20,
    });

    expect(builder.select).toHaveBeenCalledWith(
      expect.arrayContaining(['user.id', 'school.cue']),
    );
    expect(builder.orderBy).toHaveBeenCalledWith('user.lastName', 'ASC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('user.firstName', 'ASC');
    expect(builder.skip).toHaveBeenCalledWith(40);
    expect(builder.take).toHaveBeenCalledWith(20);
    expect(response.pagination).toEqual({
      page: 3,
      limit: 20,
      total: 61,
      totalPages: 4,
    });
  });

  it('busca colegios de forma paginada sin cargar el padrón completo', async () => {
    const schools = [
      {
        id: 'school-id',
        cue: '2332',
        name: 'Escuela Norte',
        isActive: true,
      },
    ] as School[];
    const builder = {
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([schools, 41]),
    };
    const dataSource = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => builder),
      })),
    } as unknown as DataSource;

    const response = await new AdminUsersService(dataSource).listSchools({
      search: 'norte',
      page: 2,
      limit: 20,
    });

    expect(builder.skip).toHaveBeenCalledWith(20);
    expect(builder.take).toHaveBeenCalledWith(20);
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(school.name) LIKE :search'),
      { search: '%norte%' },
    );
    expect(response).toEqual({
      items: [
        {
          id: 'school-id',
          cue: '2332',
          code: '2332',
          name: 'Escuela Norte',
          isActive: true,
        },
      ],
      pagination: { page: 2, limit: 20, total: 41, totalPages: 3 },
    });
  });

  it('creates a user with a hashed temporary password and a safe audit record', async () => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
    };
    const createMock = jest.fn(
      (_entity: unknown, values: Record<string, unknown>) => values,
    );
    const saveMock = jest.fn(
      (entity: unknown, values: Record<string, unknown>) =>
        Promise.resolve(
          entity === User ? { ...values, id: 'user-id' } : values,
        ),
    );
    const manager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: () => queryBuilder,
      })),
      create: createMock,
      save: saveMock,
    };
    const persistedUser = {
      id: 'user-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@mendoza.gov.ar',
      role: UserRole.Admin,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userSchools: [],
    } as User;
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<string>) =>
          callback(manager),
      ),
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(persistedUser),
      })),
    } as unknown as DataSource;
    const service = new AdminUsersService(dataSource);

    const created = await service.create(
      {
        firstName: ' Ana ',
        lastName: ' Pérez ',
        email: 'ANA@MENDOZA.GOV.AR',
        role: UserRole.Admin,
        temporaryPassword: 'Temporal!Clave2026',
      },
      { id: 'actor-id' } as never,
    );

    const userSave = saveMock.mock.calls.find(([entity]) => entity === User);
    const auditSave = saveMock.mock.calls.find(
      ([entity]) => entity === AuditLog,
    );
    const userValues = userSave?.[1] as { passwordHash?: string } | undefined;
    expect(userValues?.passwordHash).not.toBe('Temporal!Clave2026');
    expect(auditSave?.[1]).toMatchObject({
      action: 'USER_CREATED',
      actorUserId: 'actor-id',
    });
    expect(JSON.stringify(auditSave?.[1])).not.toContain('Temporal!Clave2026');
    expect(created.email).toBe('ana@mendoza.gov.ar');
  });

  it('returns a structured email conflict for a concurrent unique violation', async () => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
    };
    const manager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: () => queryBuilder,
      })),
      create: jest.fn((_entity: unknown, values: unknown) => values),
      save: jest.fn((entity: unknown) => {
        if (entity === User)
          return Promise.reject(
            Object.assign(new Error('duplicate email'), {
              code: '23505',
              constraint: 'IDX_users_email_unique',
            }),
          );
        return Promise.resolve({});
      }),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<string>) =>
          callback(manager),
      ),
    } as unknown as DataSource;

    const promise = new AdminUsersService(dataSource).create(
      {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ANA@EXAMPLE.COM',
        role: UserRole.Admin,
        temporaryPassword: 'Temporal!Clave2026',
      },
      { id: 'actor-id' } as never,
    );

    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    await expect(promise).rejects.toMatchObject({
      response: {
        code: 'USER_EMAIL_CONFLICT',
        field: 'email',
        message: 'Ya existe un usuario con ese correo.',
      },
    });
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'LOWER(user.email) = :email',
      { email: 'ana@example.com' },
    );
  });

  it('does not mislabel an unrelated unique violation as duplicate email', async () => {
    const databaseError = {
      code: '23505',
      constraint: 'IDX_user_schools_one_user_per_school',
    };
    const manager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: () => ({
          where: jest.fn().mockReturnThis(),
          getExists: jest.fn().mockResolvedValue(false),
        }),
      })),
      create: jest.fn((_entity: unknown, values: unknown) => values),
      save: jest.fn().mockRejectedValue(databaseError),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<string>) =>
          callback(manager),
      ),
    } as unknown as DataSource;

    await expect(
      new AdminUsersService(dataSource).create(
        {
          firstName: 'Ana',
          lastName: 'Pérez',
          email: 'ana@example.com',
          role: UserRole.Admin,
          temporaryPassword: 'Temporal!Clave2026',
        },
        { id: 'actor-id' } as never,
      ),
    ).rejects.toBe(databaseError);
  });

  it('revokes sessions and forces a password change after an administrative reset', async () => {
    const execute = jest.fn().mockResolvedValue({ affected: 2 });
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute,
    };
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const save = jest.fn().mockResolvedValue({});
    const manager = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'user-id',
        mustChangePassword: false,
      }),
      update,
      createQueryBuilder: jest.fn(() => queryBuilder),
      save,
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;

    await new AdminUsersService(dataSource).resetPassword(
      'user-id',
      'Temporal!Nueva2026',
      { id: 'actor-id' } as never,
    );

    expect(update).toHaveBeenCalledWith(
      User,
      'user-id',
      expect.objectContaining({
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      AuditLog,
      expect.objectContaining({ action: 'USER_PASSWORD_RESET' }),
    );
  });

  it('prevents blocking the last active administrator', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'admin-id',
        role: UserRole.Admin,
        isActive: true,
        userSchools: [],
      }),
    };
    const manager = {
      getRepository: jest.fn(() => repository),
      countBy: jest.fn().mockResolvedValue(1),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;

    await expect(
      new AdminUsersService(dataSource).setStatus('admin-id', false, {
        id: 'other-admin-id',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
