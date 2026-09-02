import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { PasswordResetToken } from '../../auth/entities/password-reset-token.entity';
import { MailService } from '../../mail/services/mail.service';
import { School } from '../../schools/entities/school.entity';
import { SchoolUserAssignmentHistory } from '../../schools/entities/school-user-assignment-history.entity';
import { UserRole } from '../entities/user-role.enum';
import { UserSchool } from '../entities/user-school.entity';
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
    const sendAccountWelcome = jest.fn().mockResolvedValue(undefined);
    const mailService = {
      isConfigured: jest.fn().mockReturnValue(true),
      sendAccountWelcome,
    } as unknown as MailService;
    const service = new AdminUsersService(dataSource, mailService);

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
    expect(created.invitationEmailSent).toBe(true);
    expect(sendAccountWelcome).toHaveBeenCalledWith({
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@mendoza.gov.ar',
      temporaryPassword: 'Temporal!Clave2026',
    });
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

  it('permite dejar sin colegio a un usuario Escuela durante la edición', async () => {
    const user = {
      id: 'user-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      role: UserRole.School,
      isActive: true,
      userSchools: [{ userId: 'user-id', schoolId: 'old-school-id' }],
    } as User;
    const save = jest.fn().mockResolvedValue({});
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(user),
      })),
      query: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn((entity: unknown, criteria: { userId?: string }) =>
        Promise.resolve(
          entity === UserSchool && criteria.userId === user.id
            ? { userId: user.id, schoolId: 'old-school-id' }
            : null,
        ),
      ),
      save,
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const service = new AdminUsersService(dataSource);
    jest.spyOn(service, 'findOne').mockResolvedValue(user as never);

    await service.update(user.id, { role: UserRole.School, schoolId: null }, {
      id: 'actor-id',
    } as never);

    expect(manager.delete).toHaveBeenCalledWith(UserSchool, {
      userId: user.id,
    });
    expect(save).toHaveBeenCalledWith(
      SchoolUserAssignmentHistory,
      expect.objectContaining({
        schoolId: 'old-school-id',
        previousUserId: user.id,
        newUserId: null,
        action: 'unassigned',
      }),
    );
  });

  it('asocia un usuario sin colegio a un establecimiento disponible', async () => {
    const user = {
      id: 'user-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      role: UserRole.School,
      isActive: true,
      userSchools: [],
    } as unknown as User;
    const targetSchool = {
      id: 'new-school-id',
      isActive: true,
    } as School;
    const findUser = jest.fn().mockResolvedValue(user);
    const save = jest.fn().mockResolvedValue({});
    const manager = {
      getRepository: jest.fn(() => ({ findOne: findUser })),
      query: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn((entity: unknown) =>
        Promise.resolve(entity === School ? targetSchool : null),
      ),
      save,
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const service = new AdminUsersService(dataSource);
    jest.spyOn(service, 'findOne').mockResolvedValue(user as never);

    await service.update(
      user.id,
      { role: UserRole.School, schoolId: targetSchool.id },
      { id: 'actor-id' } as never,
    );

    expect(findUser).toHaveBeenCalledWith({
      where: { id: user.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(save).toHaveBeenCalledWith(UserSchool, {
      userId: user.id,
      schoolId: targetSchool.id,
    });
    expect(save).toHaveBeenCalledWith(
      SchoolUserAssignmentHistory,
      expect.objectContaining({
        schoolId: targetSchool.id,
        previousUserId: null,
        newUserId: user.id,
        action: 'assigned',
      }),
    );
  });

  it('reemplaza la asociación existente al cambiar un usuario de colegio', async () => {
    const user = {
      id: 'user-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      role: UserRole.School,
      isActive: true,
      userSchools: [{ userId: 'user-id', schoolId: 'old-school-id' }],
    } as User;
    const targetSchool = {
      id: 'new-school-id',
      isActive: true,
    } as School;
    const occupied = {
      userId: 'displaced-user-id',
      schoolId: targetSchool.id,
    } as UserSchool;
    const save = jest.fn().mockResolvedValue({});
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(user),
      })),
      query: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(
        (entity: unknown, criteria: { userId?: string; schoolId?: string }) => {
          if (entity === School) return Promise.resolve(targetSchool);
          if (criteria.userId === user.id)
            return Promise.resolve({
              userId: user.id,
              schoolId: 'old-school-id',
            });
          return Promise.resolve(occupied);
        },
      ),
      save,
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const service = new AdminUsersService(dataSource);
    jest.spyOn(service, 'findOne').mockResolvedValue(user as never);

    await service.update(
      user.id,
      { role: UserRole.School, schoolId: targetSchool.id },
      { id: 'actor-id' } as never,
    );

    expect(manager.delete).toHaveBeenCalledWith(UserSchool, {
      userId: 'displaced-user-id',
    });
    expect(save).toHaveBeenCalledWith(UserSchool, {
      userId: user.id,
      schoolId: targetSchool.id,
    });
    expect(save).toHaveBeenCalledWith(
      SchoolUserAssignmentHistory,
      expect.objectContaining({
        schoolId: targetSchool.id,
        previousUserId: 'displaced-user-id',
        newUserId: user.id,
        action: 'replaced',
      }),
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
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-id',
        mustChangePassword: false,
      }),
    };
    const manager = {
      getRepository: jest.fn(() => userRepository),
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
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(update).toHaveBeenNthCalledWith(
      2,
      PasswordResetToken,
      expect.objectContaining({ userId: 'user-id' }),
      expect.objectContaining({}),
    );
    const tokenUpdate = update.mock.calls[1] as unknown as [
      typeof PasswordResetToken,
      { userId: string; usedAt: unknown },
      { usedAt: unknown },
    ];
    expect(tokenUpdate[2].usedAt).toBeInstanceOf(Date);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      AuditLog,
      expect.objectContaining({ action: 'USER_PASSWORD_RESET' }),
    );
  });

  it('invalidates recovery links when an administrator changes the account email', async () => {
    const user = {
      id: 'user-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'anterior@example.com',
      role: UserRole.Admin,
      isActive: true,
      mustChangePassword: false,
      userSchools: [],
    } as User;
    const emailQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
    };
    const sessionQuery = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(user),
      createQueryBuilder: jest.fn(() => emailQuery),
    };
    const manager = {
      getRepository: jest.fn(() => userRepository),
      findOneBy: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      update,
      createQueryBuilder: jest.fn(() => sessionQuery),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const service = new AdminUsersService(dataSource);
    jest.spyOn(service, 'findOne').mockResolvedValue(user as never);

    await service.update(user.id, { email: 'nuevo@example.com' }, {
      id: 'actor-id',
    } as never);

    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: user.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(update).toHaveBeenCalledWith(
      PasswordResetToken,
      expect.objectContaining({ userId: user.id }),
      expect.objectContaining({}),
    );
    expect(sessionQuery.execute).toHaveBeenCalledTimes(1);
  });

  it('invalidates recovery links when a blocked account is reactivated', async () => {
    const user = {
      id: 'user-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      role: UserRole.School,
      isActive: false,
      mustChangePassword: false,
      userSchools: [],
    } as User;
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const userRepository = { findOne: jest.fn().mockResolvedValue(user) };
    const manager = {
      getRepository: jest.fn(() => userRepository),
      save: jest.fn().mockResolvedValue({}),
      update,
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const service = new AdminUsersService(dataSource);
    jest.spyOn(service, 'findOne').mockResolvedValue(user as never);

    await service.setStatus(user.id, true, { id: 'actor-id' } as never);

    expect(update).toHaveBeenCalledWith(
      PasswordResetToken,
      expect.objectContaining({ userId: user.id }),
      expect.objectContaining({}),
    );
  });

  it('prevents blocking the last active administrator', async () => {
    const query = jest.fn().mockResolvedValue([]);
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
      query,
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
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      ['admin-users.active-administrator-invariant.v1'],
    );
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findOne.mock.invocationCallOrder[0],
    );
  });

  it('uses the same serialized invariant when demoting an active administrator', async () => {
    const user = {
      id: 'admin-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      role: UserRole.Admin,
      isActive: true,
      userSchools: [],
    } as User;
    const query = jest.fn().mockResolvedValue([]);
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(user),
      })),
      findOneBy: jest.fn().mockResolvedValue(null),
      query,
      countBy: jest.fn().mockResolvedValue(1),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;

    await expect(
      new AdminUsersService(dataSource).update(
        user.id,
        { role: UserRole.School, schoolId: null },
        { id: 'other-admin-id' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      ['admin-users.active-administrator-invariant.v1'],
    );
    const userLookup = manager.getRepository.mock.results[0]?.value as {
      findOne: jest.Mock;
    };
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(
      userLookup.findOne.mock.invocationCallOrder[0],
    );
  });

  it('serializes an isActive update before locking the target administrator', async () => {
    const user = {
      id: 'admin-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      role: UserRole.Admin,
      isActive: true,
      userSchools: [],
    } as User;
    const findOne = jest.fn().mockResolvedValue(user);
    const query = jest.fn().mockResolvedValue([]);
    const manager = {
      getRepository: jest.fn(() => ({ findOne })),
      findOneBy: jest.fn().mockResolvedValue(null),
      query,
      countBy: jest.fn().mockResolvedValue(1),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;

    await expect(
      new AdminUsersService(dataSource).update(user.id, { isActive: false }, {
        id: 'other-admin-id',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(
      findOne.mock.invocationCallOrder[0],
    );
  });
});
