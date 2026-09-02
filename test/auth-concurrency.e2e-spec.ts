import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthSession } from '../src/modules/auth/entities/auth-session.entity';
import { PasswordResetToken } from '../src/modules/auth/entities/password-reset-token.entity';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { MailService } from '../src/modules/mail/services/mail.service';
import { UserRole } from '../src/modules/users/entities/user-role.enum';
import { User } from '../src/modules/users/entities/user.entity';

const describeWithDatabase = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithDatabase(
  'AUTH-08 authentication serialization (PostgreSQL)',
  () => {
    let app: INestApplication<Server>;
    let dataSource: DataSource;
    let authService: AuthService;
    let userId: string;

    const sentResetTokens: string[] = [];
    const runId = randomUUID().replaceAll('-', '');
    const email = `auth.concurrent.${runId}@example.com`;
    const currentPassword = 'Actual!Segura2026';

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(MailService)
        .useValue({
          isConfigured: () => true,
          sendPasswordReset: (_email: string, token: string): Promise<void> => {
            sentResetTokens.push(token);
            return Promise.resolve();
          },
        })
        .compile();
      app = moduleRef.createNestApplication<INestApplication<Server>>();
      await app.init();
      dataSource = app.get(DataSource);
      authService = app.get(AuthService);

      const user = await dataSource.getRepository(User).save({
        firstName: 'Prueba',
        lastName: 'Concurrencia',
        email,
        passwordHash: await bcrypt.hash(currentPassword, 4),
        role: UserRole.Admin,
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      userId = user.id;
    }, 60_000);

    afterAll(async () => {
      try {
        if (userId && dataSource?.isInitialized) {
          await dataSource.transaction(async (manager) => {
            await manager.delete(PasswordResetToken, { userId });
            await manager.delete(AuthSession, { userId });
            await manager.delete(User, { id: userId });
          });
        }
      } finally {
        await app?.close();
      }
    });

    it('counts concurrent failed logins without losing increments and preserves the resulting lock', async () => {
      const maxAttempts = Number(
        app.get(ConfigService).get('LOGIN_MAX_ATTEMPTS') ?? 5,
      );

      const outcomes = await Promise.allSettled(
        Array.from({ length: maxAttempts }, () =>
          authService.login(email, 'Incorrecta!2026'),
        ),
      );

      expect(outcomes).toHaveLength(maxAttempts);
      expect(
        outcomes.every(
          (outcome) =>
            outcome.status === 'rejected' &&
            outcome.reason instanceof UnauthorizedException,
        ),
      ).toBe(true);
      const lockedUser = await dataSource.getRepository(User).findOneByOrFail({
        id: userId,
      });
      expect(lockedUser.failedLoginAttempts).toBe(0);
      expect(lockedUser.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

      // Un intento que ya estaba en vuelo no puede limpiar ni incrementar el
      // estado de bloqueo confirmado por otra transacción.
      await expect(
        authService.login(email, 'Otra!Incorrecta2026'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const stillLocked = await dataSource.getRepository(User).findOneByOrFail({
        id: userId,
      });
      expect(stillLocked.failedLoginAttempts).toBe(0);
      expect(stillLocked.lockedUntil).toEqual(lockedUser.lockedUntil);

      await dataSource.getRepository(User).update(userId, {
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
    });

    it('serializes concurrent recovery requests and leaves exactly one active token', async () => {
      sentResetTokens.length = 0;

      await Promise.all([
        authService.requestPasswordReset(email),
        authService.requestPasswordReset(email),
        authService.requestPasswordReset(email),
      ]);

      expect(sentResetTokens).toHaveLength(3);
      const tokens = await dataSource.getRepository(PasswordResetToken).find({
        where: { userId },
        order: { createdAt: 'ASC' },
      });
      expect(tokens).toHaveLength(3);
      expect(tokens.filter(({ usedAt }) => usedAt === null)).toHaveLength(1);
      const activeHash = tokens.find(
        ({ usedAt }) => usedAt === null,
      )?.tokenHash;
      expect(sentResetTokens.map(sha256)).toContain(activeHash);
    });

    it('allows only one of two distinct concurrent reset links to change the account', async () => {
      const firstToken = `first-${randomUUID()}`;
      const secondToken = `second-${randomUUID()}`;
      const firstPassword = 'Primera!Clave2026';
      const secondPassword = 'Segunda!Clave2026';
      const now = new Date();

      await dataSource.transaction(async (manager) => {
        await manager.delete(PasswordResetToken, { userId });
        await manager.getRepository(PasswordResetToken).save([
          {
            userId,
            tokenHash: sha256(firstToken),
            expiresAt: new Date(now.getTime() + 30 * 60_000),
            usedAt: null,
          },
          {
            userId,
            tokenHash: sha256(secondToken),
            expiresAt: new Date(now.getTime() + 30 * 60_000),
            usedAt: null,
          },
        ]);
        await manager.getRepository(AuthSession).save({
          tokenId: randomUUID(),
          userId,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
          revokedAt: null,
        });
        await manager.update(User, userId, {
          failedLoginAttempts: 4,
          lockedUntil: new Date(now.getTime() + 60_000),
        });
      });

      const outcomes = await Promise.allSettled([
        authService.resetPassword(firstToken, firstPassword),
        authService.resetPassword(secondToken, secondPassword),
      ]);

      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = outcomes.find(({ status }) => status === 'rejected');
      expect(rejected?.status).toBe('rejected');
      if (rejected?.status === 'rejected')
        expect(rejected.reason).toBeInstanceOf(BadRequestException);

      const persistedUser = await dataSource
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.id = :userId', { userId })
        .getOneOrFail();
      const winningPassword =
        outcomes[0].status === 'fulfilled' ? firstPassword : secondPassword;
      await expect(
        bcrypt.compare(winningPassword, persistedUser.passwordHash),
      ).resolves.toBe(true);
      expect(persistedUser.failedLoginAttempts).toBe(0);
      expect(persistedUser.lockedUntil).toBeNull();

      expect(
        await dataSource.getRepository(PasswordResetToken).countBy({
          userId,
          usedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        }),
      ).toBe(0);
      expect(
        await dataSource.getRepository(AuthSession).countBy({
          userId,
          revokedAt: IsNull(),
        }),
      ).toBe(0);
    }, 30_000);

    it('serializes an authenticated password change against an outstanding recovery link', async () => {
      const oldPassword = 'Anterior!Clave2026';
      const changedPassword = 'Elegida!Clave2026';
      const recoveredPassword = 'Recuperada!Clave2026';
      const resetToken = `change-race-${randomUUID()}`;
      const sessionId = randomUUID();
      const now = new Date();

      await dataSource.transaction(async (manager) => {
        await manager.delete(PasswordResetToken, { userId });
        await manager.delete(AuthSession, { userId });
        await manager.update(User, userId, {
          passwordHash: await bcrypt.hash(oldPassword, 4),
          failedLoginAttempts: 0,
          lockedUntil: null,
        });
        await manager.getRepository(PasswordResetToken).save({
          userId,
          tokenHash: sha256(resetToken),
          expiresAt: new Date(now.getTime() + 30 * 60_000),
          usedAt: null,
        });
        await manager.getRepository(AuthSession).save({
          tokenId: sessionId,
          userId,
          expiresAt: new Date(now.getTime() + 60 * 60_000),
          revokedAt: null,
        });
      });

      const outcomes = await Promise.allSettled([
        authService.changePassword(
          {
            id: userId,
            firstName: 'Prueba',
            lastName: 'Concurrencia',
            email,
            role: UserRole.Admin,
            sessionId,
            mustChangePassword: false,
            lastLoginAt: null,
          },
          oldPassword,
          changedPassword,
        ),
        authService.resetPassword(resetToken, recoveredPassword),
      ]);

      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const persistedUser = await dataSource
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.id = :userId', { userId })
        .getOneOrFail();
      const winningPassword =
        outcomes[0].status === 'fulfilled'
          ? changedPassword
          : recoveredPassword;
      await expect(
        bcrypt.compare(winningPassword, persistedUser.passwordHash),
      ).resolves.toBe(true);
      expect(
        await dataSource.getRepository(PasswordResetToken).countBy({
          userId,
          usedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        }),
      ).toBe(0);
      await expect(
        authService.resetPassword(resetToken, 'Tercera!Clave2026'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }, 30_000);
  },
);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
