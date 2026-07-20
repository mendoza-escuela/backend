import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { UserRole } from '../../users/entities/user-role.enum';
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
    recordSuccessfulLogin: jest.fn(),
    recordFailedLogin: jest.fn(),
  };
  const sessionsRepository = { save: jest.fn() };
  const resetTokensRepository = { save: jest.fn(), update: jest.fn() };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  const mailService = { sendPasswordReset: jest.fn() };

  const service = new AuthService(
    jwtService as unknown as JwtService,
    usersService as unknown as UsersService,
    { get: jest.fn() } as unknown as ConfigService,
    mailService as unknown as MailService,
    {} as DataSource,
    sessionsRepository as unknown as Repository<AuthSession>,
    resetTokensRepository as unknown as Repository<PasswordResetToken>,
  );

  beforeEach(() => jest.clearAllMocks());

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
});
