import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { DataSource, FindOperator, Repository } from 'typeorm';
import { MailService } from '../../mail/services/mail.service';
import { School } from '../../schools/entities/school.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { UserSchool } from '../../users/entities/user-school.entity';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/services/users.service';
import { AuthSession } from '../entities/auth-session.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const usersService = {
    findByEmailWithPassword: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
  };
  const sessionsRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const resetTokensRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  const mailService = { sendPasswordReset: jest.fn() };

  const lockedUserQuery = chainable({
    addSelect: jest.fn(),
    where: jest.fn(),
    setLock: jest.fn(),
    getOne: jest.fn(),
  });
  const sessionRevocationQuery = chainable({
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: jest.fn(),
  });
  const userRepository = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => lockedUserQuery),
  };
  const schoolRepository = { findOne: jest.fn() };
  const transactionalSessionsRepository = { save: jest.fn() };
  const transactionalResetTokensRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const manager = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => sessionRevocationQuery),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === User) return userRepository;
      if (entity === School) return schoolRepository;
      if (entity === AuthSession) return transactionalSessionsRepository;
      if (entity === PasswordResetToken)
        return transactionalResetTokensRepository;
      throw new Error('Repositorio transaccional inesperado.');
    }),
  };
  const dataSource = {
    manager,
    transaction: jest.fn(
      (callback: (entityManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    ),
  };

  const service = new AuthService(
    jwtService as unknown as JwtService,
    usersService as unknown as UsersService,
    { get: jest.fn() } as unknown as ConfigService,
    mailService as unknown as MailService,
    dataSource as unknown as DataSource,
    sessionsRepository as unknown as Repository<AuthSession>,
    resetTokensRepository as unknown as Repository<PasswordResetToken>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    lockedUserQuery.getOne.mockResolvedValue(null);
    userRepository.findOne.mockResolvedValue(null);
    schoolRepository.findOne.mockResolvedValue(null);
    transactionalResetTokensRepository.findOne.mockResolvedValue(null);
    manager.findOne.mockResolvedValue(null);
    manager.findOneBy.mockResolvedValue(null);
    manager.update.mockResolvedValue({ affected: 1 });
    sessionRevocationQuery.execute.mockResolvedValue({ affected: 1 });
    sessionsRepository.findOne.mockResolvedValue(null);
    resetTokensRepository.findOne.mockResolvedValue(null);
    usersService.findById.mockResolvedValue(null);
    mailService.sendPasswordReset.mockResolvedValue(undefined);
  });

  it('serializes a successful login and commits its counter reset with the session', async () => {
    const user = await adminUser({
      failedLoginAttempts: 3,
      lockedUntil: new Date('2025-01-01T00:00:00.000Z'),
      lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    lockedUserQuery.getOne.mockResolvedValue({ ...user });

    const login = await service.login(
      ' ADMIN@MENDOZA.GOV.AR ',
      'Clave!Segura2026',
    );

    expect(usersService.findByEmailWithPassword).toHaveBeenCalledWith(
      'admin@mendoza.gov.ar',
    );
    expect(lockedUserQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    const [, updatedUserId, loginValues] = mockCalls<
      [
        typeof User,
        string,
        { failedLoginAttempts: number; lockedUntil: null; lastLoginAt: Date },
      ]
    >(manager.update)[0];
    expect(updatedUserId).toBe(user.id);
    expect(loginValues).toMatchObject({
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    expect(loginValues.lastLoginAt).toBeInstanceOf(Date);
    expect(transactionalSessionsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, revokedAt: null }),
    );
    expect(login.user.lastLoginAt).toEqual(user.lastLoginAt);
  });

  it('increments failed attempts from the locked value instead of a stale login read', async () => {
    const staleUser = await adminUser({ failedLoginAttempts: 0 });
    const lockedUser = { ...staleUser, failedLoginAttempts: 3 };
    usersService.findByEmailWithPassword.mockResolvedValue(staleUser);
    lockedUserQuery.getOne.mockResolvedValue(lockedUser);

    await expect(
      service.login(staleUser.email, 'Contraseña incorrecta'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(manager.update).toHaveBeenCalledWith(User, staleUser.id, {
      failedLoginAttempts: 4,
      lockedUntil: null,
    });
    expect(transactionalSessionsRepository.save).not.toHaveBeenCalled();
  });

  it('does not clear or increment a lock established while another login was hashing', async () => {
    const staleUser = await adminUser({ failedLoginAttempts: 4 });
    const lockedUntil = new Date(Date.now() + 15 * 60_000);
    usersService.findByEmailWithPassword.mockResolvedValue(staleUser);
    lockedUserQuery.getOne.mockResolvedValue({
      ...staleUser,
      failedLoginAttempts: 0,
      lockedUntil,
    });

    await expect(
      service.login(staleUser.email, 'Contraseña incorrecta'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(manager.update).not.toHaveBeenCalled();
    expect(transactionalSessionsRepository.save).not.toHaveBeenCalled();
  });

  it('rechecks the password if a reset changed its hash before the login acquired the lock', async () => {
    const staleUser = await adminUser();
    const currentUser = {
      ...staleUser,
      passwordHash: await bcrypt.hash('Nueva!Clave2026', 4),
    };
    usersService.findByEmailWithPassword.mockResolvedValue(staleUser);
    lockedUserQuery.getOne.mockResolvedValue(currentUser);

    await expect(
      service.login(staleUser.email, 'Clave!Segura2026'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(manager.update).toHaveBeenCalledWith(User, staleUser.id, {
      failedLoginAttempts: 1,
      lockedUntil: null,
    });
    expect(transactionalSessionsRepository.save).not.toHaveBeenCalled();
  });

  it('creates a school session while its user and active school remain locked', async () => {
    const user = await schoolUser();
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    lockedUserQuery.getOne.mockResolvedValue({ ...user });
    manager.findOneBy
      .mockResolvedValueOnce({ userId: user.id, schoolId: 'school-id' })
      .mockResolvedValueOnce({ userId: user.id, schoolId: 'school-id' });
    schoolRepository.findOne.mockResolvedValue({
      id: 'school-id',
      isActive: true,
    });

    await service.login(user.email, 'Clave!Segura2026');

    expect(schoolRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'school-id' },
      lock: { mode: 'pessimistic_read' },
    });
    expect(schoolRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      lockedUserQuery.getOne.mock.invocationCallOrder[0],
    );
    expect(manager.findOneBy).toHaveBeenNthCalledWith(2, UserSchool, {
      userId: user.id,
      schoolId: 'school-id',
    });
    expect(transactionalSessionsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'inactive school',
      { userId: 'school-user-id', schoolId: 'school-id' },
      { id: 'school-id', isActive: false },
    ],
    ['missing school assignment', null, null],
  ])(
    'rejects a school login with generic credentials for %s',
    async (_caseName, association, school) => {
      const user = await schoolUser();
      usersService.findByEmailWithPassword.mockResolvedValue(user);
      lockedUserQuery.getOne.mockResolvedValue({ ...user });
      manager.findOneBy.mockResolvedValue(association);
      schoolRepository.findOne.mockResolvedValue(school);

      await expect(
        service.login(user.email, 'Clave!Segura2026'),
      ).rejects.toThrow('Correo o contraseña incorrectos.');

      expect(transactionalSessionsRepository.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    },
  );

  it('invalidates old reset links and creates the replacement in one user-locked transaction', async () => {
    const user = await adminUser();
    usersService.findByEmail.mockResolvedValue(user);
    userRepository.findOne.mockResolvedValue({ ...user });

    await service.requestPasswordReset(' ADMIN@MENDOZA.GOV.AR ');

    expect(usersService.findByEmail).toHaveBeenCalledWith(
      'admin@mendoza.gov.ar',
    );
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: user.id },
      lock: { mode: 'pessimistic_write' },
    });
    const [tokenEntity, invalidationCriteria, invalidationValues] = mockCalls<
      [
        typeof PasswordResetToken,
        { userId: string; usedAt: FindOperator<null> },
        { usedAt: Date },
      ]
    >(manager.update)[0];
    expect(tokenEntity).toBe(PasswordResetToken);
    expect(invalidationCriteria.userId).toBe(user.id);
    expect(invalidationCriteria.usedAt).toBeInstanceOf(FindOperator);
    expect(invalidationValues.usedAt).toBeInstanceOf(Date);
    const [savedToken] = mockCalls<
      [
        {
          userId: string;
          tokenHash: string;
          expiresAt: Date;
          usedAt: null;
        },
      ]
    >(transactionalResetTokensRepository.save)[0];
    expect(savedToken).toMatchObject({ userId: user.id, usedAt: null });
    expect(savedToken.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(savedToken.expiresAt).toBeInstanceOf(Date);
    expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
      transactionalResetTokensRepository.save.mock.invocationCallOrder[0],
    );
    expect(mailService.sendPasswordReset).toHaveBeenCalledWith(
      user.email,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it('keeps recovery anti-enumeration and does not load a password hash', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await service.requestPasswordReset(' desconocido@colegio.edu.ar ');

    expect(usersService.findByEmail).toHaveBeenCalledWith(
      'desconocido@colegio.edu.ar',
    );
    expect(usersService.findByEmailWithPassword).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('invalidates only its own token if sending the recovery email fails', async () => {
    const user = await adminUser();
    usersService.findByEmail.mockResolvedValue(user);
    userRepository.findOne.mockResolvedValue({ ...user });
    mailService.sendPasswordReset.mockRejectedValue(new Error('SMTP down'));

    await service.requestPasswordReset(user.email);

    const [issuedToken] = mockCalls<[{ tokenHash: string }]>(
      transactionalResetTokensRepository.save,
    )[0];
    const [criteria, values] = mockCalls<
      [{ tokenHash: string; usedAt: FindOperator<null> }, { usedAt: Date }]
    >(resetTokensRepository.update)[0];
    expect(criteria.tokenHash).toBe(issuedToken.tokenHash);
    expect(criteria.usedAt).toBeInstanceOf(FindOperator);
    expect(values.usedAt).toBeInstanceOf(Date);
  });

  it('consumes every active reset link, changes the password and revokes sessions atomically', async () => {
    const user = await adminUser({
      failedLoginAttempts: 4,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const rawToken = 'token-reset-valido';
    const tokenHash = sha256(rawToken);
    resetTokensRepository.findOne.mockResolvedValue({
      id: 'token-id',
      userId: user.id,
    });
    userRepository.findOne.mockResolvedValue({ ...user });
    transactionalResetTokensRepository.findOne.mockResolvedValue({
      id: 'token-id',
      userId: user.id,
      tokenHash,
    });

    await service.resetPassword(rawToken, 'Nueva!Clave2026');

    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: user.id },
      lock: { mode: 'pessimistic_write' },
    });
    const [tokenLookup] = mockCalls<
      [
        {
          where: {
            tokenHash: string;
            usedAt: FindOperator<null>;
            expiresAt: FindOperator<Date>;
          };
          lock: { mode: string };
        },
      ]
    >(transactionalResetTokensRepository.findOne)[0];
    expect(tokenLookup.where.tokenHash).toBe(tokenHash);
    expect(tokenLookup.where.usedAt).toBeInstanceOf(FindOperator);
    expect(tokenLookup.where.expiresAt).toBeInstanceOf(FindOperator);
    expect(tokenLookup.lock.mode).toBe('pessimistic_write');
    const updateCalls = mockCalls<[unknown, unknown, Record<string, unknown>]>(
      manager.update,
    );
    const userUpdate = updateCalls.find(([entity]) => entity === User);
    expect(userUpdate?.[1]).toBe(user.id);
    expect(userUpdate?.[2]).toMatchObject({
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    expect(typeof userUpdate?.[2].passwordHash).toBe('string');
    const tokensUpdate = updateCalls.find(
      ([entity]) => entity === PasswordResetToken,
    );
    const tokensCriteria = tokensUpdate?.[1] as
      { userId: string; usedAt: FindOperator<null> } | undefined;
    expect(tokensCriteria?.userId).toBe(user.id);
    expect(tokensCriteria?.usedAt).toBeInstanceOf(FindOperator);
    expect(tokensUpdate?.[2].usedAt).toBeInstanceOf(Date);
    expect(sessionRevocationQuery.update).toHaveBeenCalledWith(AuthSession);
    expect(sessionRevocationQuery.execute).toHaveBeenCalledTimes(1);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('revalidates a reset link after acquiring the user lock', async () => {
    const user = await adminUser();
    resetTokensRepository.findOne.mockResolvedValue({
      id: 'token-id',
      userId: user.id,
    });
    userRepository.findOne.mockResolvedValue({ ...user });
    transactionalResetTokensRepository.findOne.mockResolvedValue(null);

    await expect(
      service.resetPassword('ya-consumido', 'Nueva!Clave2026'),
    ).rejects.toThrow('El enlace es inválido, ya fue usado o venció.');

    expect(manager.update).not.toHaveBeenCalled();
    expect(sessionRevocationQuery.execute).not.toHaveBeenCalled();
  });

  it('changes a password and revokes the other sessions in the same transaction', async () => {
    const user = await adminUser();
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    lockedUserQuery.getOne.mockResolvedValue({ ...user });

    await service.changePassword(
      {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        sessionId: 'current-session',
        mustChangePassword: false,
        lastLoginAt: null,
      },
      'Clave!Segura2026',
      'Nueva!Clave2026',
    );

    expect(lockedUserQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    const [, changedUserId, changedValues] = mockCalls<
      [typeof User, string, Record<string, unknown>]
    >(manager.update)[0];
    expect(changedUserId).toBe(user.id);
    expect(changedValues).toMatchObject({
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    expect(typeof changedValues.passwordHash).toBe('string');
    expect(sessionRevocationQuery.andWhere).toHaveBeenCalledWith(
      'token_id <> :exceptTokenId',
      { exceptTokenId: 'current-session' },
    );
    const tokenInvalidation = mockCalls<
      [
        typeof PasswordResetToken,
        { userId: string; usedAt: FindOperator<null> },
        { usedAt: Date },
      ]
    >(manager.update).find(([entity]) => entity === PasswordResetToken);
    expect(tokenInvalidation?.[1].userId).toBe(user.id);
    expect(tokenInvalidation?.[1].usedAt).toBeInstanceOf(FindOperator);
    expect(tokenInvalidation?.[2].usedAt).toBeInstanceOf(Date);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('validates an active school association for every school session', async () => {
    const user = await schoolUser();
    sessionsRepository.findOne.mockResolvedValue({
      tokenId: 'session-id',
      userId: user.id,
    });
    usersService.findById.mockResolvedValue(user);
    manager.findOne.mockResolvedValue({
      userId: user.id,
      school: { id: 'school-id', isActive: true },
    });

    const validated = await service.validateSession(user.id, 'session-id');

    expect(validated).toMatchObject({
      id: user.id,
      role: UserRole.School,
      sessionId: 'session-id',
    });
    expect(manager.findOne).toHaveBeenCalledWith(UserSchool, {
      where: { userId: user.id },
      relations: { school: true },
    });
    expect(sessionsRepository.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'inactive school',
      {
        userId: 'school-user-id',
        school: { id: 'school-id', isActive: false },
      },
    ],
    ['missing school assignment', null],
  ])(
    'revokes the SID and rejects validation for %s',
    async (_caseName, association) => {
      const user = await schoolUser();
      sessionsRepository.findOne.mockResolvedValue({
        tokenId: 'session-id',
        userId: user.id,
      });
      usersService.findById.mockResolvedValue(user);
      manager.findOne.mockResolvedValue(association);

      await expect(
        service.validateSession(user.id, 'session-id'),
      ).rejects.toThrow('La sesión no es válida o venció.');

      const [criteria, values] = mockCalls<
        [
          {
            tokenId: string;
            userId: string;
            revokedAt: FindOperator<null>;
          },
          { revokedAt: Date },
        ]
      >(sessionsRepository.update)[0];
      expect(criteria.tokenId).toBe('session-id');
      expect(criteria.userId).toBe(user.id);
      expect(criteria.revokedAt).toBeInstanceOf(FindOperator);
      expect(values.revokedAt).toBeInstanceOf(Date);
    },
  );

  it('keeps administrator session validation independent from schools', async () => {
    const user = await adminUser();
    sessionsRepository.findOne.mockResolvedValue({
      tokenId: 'admin-session-id',
      userId: user.id,
    });
    usersService.findById.mockResolvedValue(user);

    await expect(
      service.validateSession(user.id, 'admin-session-id'),
    ).resolves.toMatchObject({ id: user.id, role: UserRole.Admin });

    expect(manager.findOne).not.toHaveBeenCalled();
    expect(sessionsRepository.update).not.toHaveBeenCalled();
  });

  async function adminUser(overrides: Partial<User> = {}): Promise<User> {
    return {
      id: 'admin-id',
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'admin@mendoza.gov.ar',
      passwordHash: await bcrypt.hash('Clave!Segura2026', 4),
      role: UserRole.Admin,
      isActive: true,
      mustChangePassword: false,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...overrides,
    } as User;
  }

  async function schoolUser(): Promise<User> {
    return adminUser({
      id: 'school-user-id',
      firstName: 'Ana',
      lastName: 'Escuela',
      email: 'escuela@mendoza.edu.ar',
      role: UserRole.School,
    });
  }
});

function chainable<T extends Record<string, jest.Mock>>(mocks: T): T {
  for (const mock of Object.values(mocks)) mock.mockReturnValue(mocks);
  return mocks;
}

function mockCalls<T extends unknown[]>(mock: jest.Mock): T[] {
  return mock.mock.calls as T[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
