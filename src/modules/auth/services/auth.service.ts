import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  DataSource,
  EntityManager,
  IsNull,
  MoreThan,
  Repository,
} from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { UsersService } from '../../users/services/users.service';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { UserSchool } from '../../users/entities/user-school.entity';
import { School } from '../../schools/entities/school.entity';
import { AuthSession } from '../entities/auth-session.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { assertStrongPassword } from '../utils/password-policy';
import { MailService } from '../../mail/services/mail.service';

type SessionUser = AuthenticatedUser & {
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
};

type NewAuthSession = Pick<
  AuthSession,
  'tokenId' | 'userId' | 'expiresAt' | 'revokedAt'
>;

type CompletedLogin = {
  user: User;
  previousLastLoginAt: Date | null;
};

/**
 * Hash señuelo con el mismo coste (12 rondas) que los reales. Se compara contra
 * él cuando la cuenta no existe para que el login tarde lo mismo en ambos casos
 * y no se pueda enumerar usuarios midiendo el tiempo de respuesta.
 * Se genera una sola vez al cargar el proceso y no corresponde a ninguna
 * cuenta ni contraseña utilizable.
 */
const DECOY_PASSWORD_HASH = bcrypt.hashSync(
  'decoy-password-not-used-for-authentication',
  12,
);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxLoginAttempts: number;
  private readonly lockMinutes: number;
  private readonly sessionHours: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(AuthSession)
    private readonly sessionsRepository: Repository<AuthSession>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokensRepository: Repository<PasswordResetToken>,
  ) {
    this.maxLoginAttempts = Number(
      configService.get('LOGIN_MAX_ATTEMPTS') ?? 5,
    );
    this.lockMinutes = Number(configService.get('LOGIN_LOCK_MINUTES') ?? 15);
    this.sessionHours = Number(
      configService.get('SESSION_DURATION_HOURS') ?? 8,
    );
  }

  /** Autentica sin revelar si la cuenta existe y registra intentos y último acceso. */
  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user =
      await this.usersService.findByEmailWithPassword(normalizedEmail);
    const invalidCredentials = new UnauthorizedException(
      'Correo o contraseña incorrectos.',
    );

    if (!user || !user.isActive) {
      // Se compara igual contra un hash señuelo para que el tiempo de respuesta
      // no delate si la cuenta existe. Sin esto, la ausencia de bcrypt.compare
      // hace que la respuesta vuelva mucho antes y permite enumerar usuarios
      // (hallazgo H-06). ASVS 5.0 V2.2.1.
      await bcrypt.compare(password, DECOY_PASSWORD_HASH);
      throw invalidCredentials;
    }

    // El coste de bcrypt se paga antes de abrir la transacción. Si otro flujo
    // cambia el hash mientras se espera el lock, completeLogin vuelve a
    // comparar contra el valor vigente antes de decidir el resultado.
    const initialPasswordMatches = await bcrypt.compare(
      password,
      user.passwordHash,
    );
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + this.sessionHours * 60 * 60_000);
    const completed = await this.completeLogin({
      userId: user.id,
      normalizedEmail,
      password,
      initialPasswordHash: user.passwordHash,
      initialPasswordMatches,
      initialRole: user.role,
      tokenId,
      expiresAt,
    });
    if (!completed) throw invalidCredentials;

    return {
      accessToken: await this.jwtService.signAsync({
        sub: completed.user.id,
        sid: tokenId,
        email: completed.user.email,
        role: completed.user.role,
      }),
      expiresAt,
      user: {
        id: completed.user.id,
        firstName: completed.user.firstName,
        lastName: completed.user.lastName,
        email: completed.user.email,
        role: completed.user.role,
        mustChangePassword: completed.user.mustChangePassword,
        lastLoginAt: completed.previousLastLoginAt,
      },
    };
  }

  async validateSession(userId: string, tokenId: string): Promise<SessionUser> {
    const session = await this.sessionsRepository.findOne({
      where: {
        tokenId,
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    const user = session ? await this.usersService.findById(userId) : null;
    if (!session || !user)
      throw new UnauthorizedException('La sesión no es válida o venció.');
    if (
      user.role === UserRole.School &&
      !(await this.hasActiveSchoolAssignment(this.dataSource.manager, user.id))
    ) {
      await this.sessionsRepository.update(
        { tokenId, userId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException('La sesión no es válida o venció.');
    }
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      sessionId: tokenId,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
    };
  }

  async logout(tokenId: string): Promise<void> {
    await this.sessionsRepository.update(
      { tokenId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(
      email.trim().toLowerCase(),
    );
    if (!user || !user.isActive) return;

    const rawToken = randomBytes(32).toString('hex');
    const expiresMinutes = Number(
      this.configService.get('PASSWORD_RESET_TOKEN_EXPIRES_MINUTES') ?? 30,
    );
    const tokenHash = this.hashToken(rawToken);
    const recipient = await this.dataSource.transaction(async (manager) => {
      // La fila de usuario es el punto de serialización compartido por login,
      // emisión y consumo. Dos solicitudes para la misma cuenta no pueden
      // intercalar "invalidar anteriores" con "crear nuevo".
      const currentUser = await manager.getRepository(User).findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!currentUser?.isActive) return null;

      const issuedAt = new Date();
      await manager.update(
        PasswordResetToken,
        { userId: currentUser.id, usedAt: IsNull() },
        { usedAt: issuedAt },
      );
      await manager.getRepository(PasswordResetToken).save({
        userId: currentUser.id,
        tokenHash,
        expiresAt: new Date(issuedAt.getTime() + expiresMinutes * 60_000),
        usedAt: null,
      });
      return currentUser.email;
    });
    if (!recipient) return;

    try {
      await this.mailService.sendPasswordReset(recipient, rawToken);
    } catch {
      await this.resetTokensRepository.update(
        { tokenHash, usedAt: IsNull() },
        { usedAt: new Date() },
      );
      this.logger.error(
        'Password recovery email could not be sent. The token was invalidated.',
      );
    }
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    assertStrongPassword(newPassword);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const tokenHash = this.hashToken(rawToken);

    // Esta lectura sólo resuelve qué fila de usuario se debe bloquear. El token
    // se vuelve a validar bajo lock dentro de la transacción; no autoriza nada.
    const tokenReference = await this.resetTokensRepository.findOne({
      select: { id: true, userId: true },
      where: { tokenHash },
    });
    if (!tokenReference) throw this.invalidResetToken();

    await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id: tokenReference.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user?.isActive) throw this.invalidResetToken();

      const resetToken = await manager
        .getRepository(PasswordResetToken)
        .findOne({
          where: {
            tokenHash,
            usedAt: IsNull(),
            expiresAt: MoreThan(new Date()),
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!resetToken) {
        throw this.invalidResetToken();
      }

      const changedAt = new Date();
      await manager.update(User, user.id, {
        passwordHash,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      await this.invalidatePasswordResetTokens(manager, user.id, changedAt);
      // Consumir todos los enlaces evita que dos tokens legados válidos
      // compitan y dejen la contraseña que termine escribiendo último.
      await this.revokeUserSessions(manager, user.id, changedAt);
    });
  }

  async changePassword(
    user: AuthenticatedUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    assertStrongPassword(newPassword);
    const initialUser = await this.usersService.findByEmailWithPassword(
      user.email,
    );
    if (
      !initialUser ||
      !(await bcrypt.compare(currentPassword, initialUser.passwordHash))
    ) {
      throw new BadRequestException('La contraseña actual es incorrecta.');
    }
    if (await bcrypt.compare(newPassword, initialUser.passwordHash)) {
      throw new BadRequestException(
        'La nueva contraseña debe ser diferente a la actual.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.dataSource.transaction(async (manager) => {
      const currentUser = await this.findLockedUserWithPassword(
        manager,
        user.id,
      );
      if (!currentUser?.isActive) {
        throw new BadRequestException('La contraseña actual es incorrecta.');
      }

      if (currentUser.passwordHash !== initialUser.passwordHash) {
        if (
          !(await bcrypt.compare(currentPassword, currentUser.passwordHash))
        ) {
          throw new BadRequestException('La contraseña actual es incorrecta.');
        }
        if (await bcrypt.compare(newPassword, currentUser.passwordHash)) {
          throw new BadRequestException(
            'La nueva contraseña debe ser diferente a la actual.',
          );
        }
      }

      const changedAt = new Date();
      await manager.update(User, user.id, {
        passwordHash,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      // Un enlace emitido antes del cambio no puede volver a reemplazar la
      // contraseña elegida por el usuario después de confirmar esta escritura.
      await this.invalidatePasswordResetTokens(manager, user.id, changedAt);
      await this.revokeUserSessions(
        manager,
        user.id,
        changedAt,
        user.sessionId,
      );
    });
  }

  private async revokeUserSessions(
    manager: EntityManager,
    userId: string,
    revokedAt: Date,
    exceptTokenId?: string,
  ): Promise<void> {
    const query = manager
      .createQueryBuilder()
      .update(AuthSession)
      .set({ revokedAt })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL');
    if (exceptTokenId)
      query.andWhere('token_id <> :exceptTokenId', { exceptTokenId });
    await query.execute();
  }

  private async invalidatePasswordResetTokens(
    manager: EntityManager,
    userId: string,
    usedAt: Date,
  ): Promise<void> {
    await manager.update(
      PasswordResetToken,
      { userId, usedAt: IsNull() },
      { usedAt },
    );
  }

  /**
   * Serializa el resultado de todos los logins de una cuenta sobre su fila.
   * Contador, bloqueo, último acceso y sesión se confirman en el mismo commit.
   */
  private completeLogin(input: {
    userId: string;
    normalizedEmail: string;
    password: string;
    initialPasswordHash: string;
    initialPasswordMatches: boolean;
    initialRole: UserRole;
    tokenId: string;
    expiresAt: Date;
  }): Promise<CompletedLogin | null> {
    return this.dataSource.transaction(async (manager) => {
      // assignUser toma School→User. Mantener el mismo orden evita un ciclo de
      // espera entre una reasignación y un login escolar concurrentes.
      const school =
        input.initialRole === UserRole.School
          ? await this.lockAssignedSchoolForLogin(manager, input.userId)
          : undefined;
      const user = await this.findLockedUserWithPassword(manager, input.userId);
      if (
        !user?.isActive ||
        user.role !== input.initialRole ||
        user.email.trim().toLowerCase() !== input.normalizedEmail
      ) {
        return null;
      }

      const now = new Date();
      if (user.lockedUntil && user.lockedUntil > now) return null;

      const passwordMatches =
        user.passwordHash === input.initialPasswordHash
          ? input.initialPasswordMatches
          : await bcrypt.compare(input.password, user.passwordHash);
      if (!passwordMatches) {
        const attempts = user.failedLoginAttempts + 1;
        const lockedUntil =
          attempts >= this.maxLoginAttempts
            ? new Date(now.getTime() + this.lockMinutes * 60_000)
            : null;
        await manager.update(User, user.id, {
          failedLoginAttempts: lockedUntil ? 0 : attempts,
          lockedUntil,
        });
        return null;
      }

      if (
        user.role === UserRole.School &&
        (!school?.isActive ||
          !(await manager.findOneBy(UserSchool, {
            userId: user.id,
            schoolId: school.id,
          })))
      ) {
        return null;
      }

      const previousLastLoginAt = user.lastLoginAt;
      await manager.update(User, user.id, {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
      });
      const session: NewAuthSession = {
        tokenId: input.tokenId,
        userId: user.id,
        expiresAt: input.expiresAt,
        revokedAt: null,
      };
      await manager.getRepository(AuthSession).save(session);
      return { user, previousLastLoginAt };
    });
  }

  /**
   * Mantiene el establecimiento estable hasta que la sesión escolar y el
   * éxito de login quedan confirmados por la transacción exterior.
   */
  private async lockAssignedSchoolForLogin(
    manager: EntityManager,
    userId: string,
  ): Promise<School | null> {
    const association = await manager.findOneBy(UserSchool, { userId });
    if (!association) return null;

    return manager.getRepository(School).findOne({
      where: { id: association.schoolId },
      lock: { mode: 'pessimistic_read' },
    });
  }

  private findLockedUserWithPassword(
    manager: EntityManager,
    userId: string,
  ): Promise<User | null> {
    return manager
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :userId', { userId })
      .setLock('pessimistic_write')
      .getOne();
  }

  /** Comprueba la asociación 1:1 en cada uso de una sesión escolar. */
  private async hasActiveSchoolAssignment(
    manager: EntityManager,
    userId: string,
  ): Promise<boolean> {
    const association = await manager.findOne(UserSchool, {
      where: { userId },
      relations: { school: true },
    });
    return association?.school.isActive === true;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private invalidResetToken(): BadRequestException {
    return new BadRequestException(
      'El enlace es inválido, ya fue usado o venció.',
    );
  }
}
