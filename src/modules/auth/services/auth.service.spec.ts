import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { UserSchool } from '../../users/entities/user-school.entity';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/services/users.service';
import { AuthSession } from '../entities/auth-session.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';

describe('AuthService', () => {
  const usersService = {
    findByEmailWithPassword: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    recordSuccessfulLogin: jest.fn(),
    recordFailedLogin: jest.fn(),
  };
  const sessionsRepository = {
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const resetTokensRepository = { save: jest.fn(), update: jest.fn() };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  const mailService = { sendPasswordReset: jest.fn() };
  const schoolRepository = { findOne: jest.fn() };
  const transactionalSessionsRepository = { save: jest.fn() };
  const manager = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    getRepository: jest.fn((entity) =>
      entity === School ? schoolRepository : transactionalSessionsRepository,
    ),
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
    manager.findOne.mockResolvedValue(null);
    manager.findOneBy.mockResolvedValue(null);
    schoolRepository.findOne.mockResolvedValue(null);
    sessionsRepository.findOne.mockResolvedValue(null);
    usersService.findById.mockResolvedValue(null);
  });

  it('loads the password hash for login and creates a revocable session', async () => {
    const user = {
      id: 'user-id',
      email: 'ADMIN@MENDOZA.COM',
      passwordHash: await bcrypt.hash('Clave!Segura2026', 4),
      role: UserRole.Admin,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: null,
      lockedUntil: null,
    } as User;
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    usersService.recordSuccessfulLogin.mockResolvedValue(new Date());
    sessionsRepository.save.mockResolvedValue({});

    const login = await service.login(
      ' ADMIN@MENDOZA.COM ',
      'Clave!Segura2026',
    );

    expect(usersService.findByEmailWithPassword).toHaveBeenCalledWith(
      'admin@mendoza.com',
    );
    expect(sessionsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-id', revokedAt: null }),
    );
    expect(login.user.mustChangePassword).toBe(true);
  });

  it('does not request a password hash during recovery', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await service.requestPasswordReset(' usuario@colegio.edu.ar ');

    expect(usersService.findByEmail).toHaveBeenCalledWith(
      'usuario@colegio.edu.ar',
    );
    expect(usersService.findByEmailWithPassword).not.toHaveBeenCalled();
  });

  it('creates a school session in the transaction that locks its active school', async () => {
    const user = await schoolUser();
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    manager.findOneBy.mockResolvedValue({
      userId: user.id,
      schoolId: 'school-id',
    });
    schoolRepository.findOne.mockResolvedValue({
      id: 'school-id',
      isActive: true,
    });

    await service.login(user.email, 'Clave!Segura2026');

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.findOneBy).toHaveBeenNthCalledWith(1, UserSchool, {
      userId: user.id,
    });
    expect(schoolRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'school-id' },
      lock: { mode: 'pessimistic_read' },
    });
    expect(manager.findOneBy).toHaveBeenNthCalledWith(2, UserSchool, {
      userId: user.id,
      schoolId: 'school-id',
    });
    expect(transactionalSessionsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, revokedAt: null }),
    );
    expect(sessionsRepository.save).not.toHaveBeenCalled();
    expect(schoolRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      transactionalSessionsRepository.save.mock.invocationCallOrder[0],
    );
    expect(manager.findOneBy.mock.invocationCallOrder[1]).toBeLessThan(
      transactionalSessionsRepository.save.mock.invocationCallOrder[0],
    );
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
      manager.findOneBy.mockResolvedValue(association);
      schoolRepository.findOne.mockResolvedValue(school);

      await expect(
        service.login(user.email, 'Clave!Segura2026'),
      ).rejects.toThrow('Correo o contraseña incorrectos.');

      expect(transactionalSessionsRepository.save).not.toHaveBeenCalled();
      expect(sessionsRepository.save).not.toHaveBeenCalled();
      expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    },
  );

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
    expect(schoolRepository.findOne).not.toHaveBeenCalled();
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

      expect(sessionsRepository.update).toHaveBeenCalledTimes(1);
      const updateCalls = sessionsRepository.update.mock
        .calls as unknown as Array<
        [Record<string, unknown>, Record<string, unknown>]
      >;
      const [criteria, values] = updateCalls[0];
      expect(criteria.tokenId).toBe('session-id');
      expect(criteria.userId).toBe(user.id);
      expect(criteria.revokedAt).toBeDefined();
      expect(values.revokedAt).toBeInstanceOf(Date);
    },
  );

  it('keeps administrator session validation independent from schools', async () => {
    const user = {
      id: 'admin-id',
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'admin@mendoza.gov.ar',
      role: UserRole.Admin,
      mustChangePassword: false,
      lastLoginAt: null,
    } as User;
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

  async function schoolUser(): Promise<User> {
    return {
      id: 'school-user-id',
      firstName: 'Ana',
      lastName: 'Escuela',
      email: 'escuela@mendoza.edu.ar',
      passwordHash: await bcrypt.hash('Clave!Segura2026', 4),
      role: UserRole.School,
      isActive: true,
      mustChangePassword: false,
      lastLoginAt: null,
      lockedUntil: null,
    } as User;
  }
});
