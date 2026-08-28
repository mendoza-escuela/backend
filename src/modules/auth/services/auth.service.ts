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

/**
 * Hash señuelo con el mismo coste (12 rondas) que los reales. Se compara contra
 * él cuando la cuenta no existe para que el login tarde lo mismo en ambos casos
 * y no se pueda enumerar usuarios midiendo el tiempo de respuesta.
 * No corresponde a ninguna contraseña utilizable.
 */
const DECOY_PASSWORD_HASH =
  '$2b$12$g7eeKoS4WUaShPDTNFpFLu1lilN76as/VT35ijKJ7BsAWvRQRm02K';

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
    const user = await this.usersService.findByEmailWithPassword(
      email.trim().toLowerCase(),
    );
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
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      // Mensaje idéntico al de credenciales inválidas: informar el bloqueo
      // confirmaba la existencia de la cuenta a cualquiera que probara cinco
      // veces un correo. El usuario legítimo recupera el acceso por el flujo de
      // contraseña olvidada o esperando el desbloqueo.
      throw invalidCredentials;
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await this.usersService.recordFailedLogin(
        user,
        this.maxLoginAttempts,
        this.lockMinutes,
      );
      throw invalidCredentials;
    }

    const previousLastLoginAt = user.lastLoginAt;
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + this.sessionHours * 60 * 60_000);
    const session: NewAuthSession = {
      tokenId,
      userId: user.id,
      expiresAt,
      revokedAt: null,
    };

    if (user.role === UserRole.School) {
      const sessionCreated = await this.createSchoolSessionIfActive(session);
      if (!sessionCreated) throw invalidCredentials;
      await this.usersService.recordSuccessfulLogin(user.id);
    } else {
      await this.usersService.recordSuccessfulLogin(user.id);
      await this.sessionsRepository.save(session);
    }

    return {
      accessToken: await this.jwtService.signAsync({
        sub: user.id,
        sid: tokenId,
        email: user.email,
        role: user.role,
      }),
      expiresAt,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        lastLoginAt: previousLastLoginAt,
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

    await this.resetTokensRepository.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    const rawToken = randomBytes(32).toString('hex');
    const expiresMinutes = Number(
      this.configService.get('PASSWORD_RESET_TOKEN_EXPIRES_MINUTES') ?? 30,
    );
    const tokenHash = this.hashToken(rawToken);
    await this.resetTokensRepository.save({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + expiresMinutes * 60_000),
      usedAt: null,
    });

    try {
      await this.mailService.sendPasswordReset(user.email, rawToken);
    } catch {
      await this.resetTokensRepository.update(
        { tokenHash },
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

    await this.dataSource.transaction(async (manager) => {
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
        throw new BadRequestException(
          'El enlace es inválido, ya fue usado o venció.',
        );
      }

      await manager.update(User, resetToken.userId, {
        passwordHash,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      await manager.update(PasswordResetToken, resetToken.id, {
        usedAt: new Date(),
      });
      await manager
        .createQueryBuilder()
        .update(AuthSession)
        .set({ revokedAt: new Date() })
        .where('user_id = :userId', { userId: resetToken.userId })
        .andWhere('revoked_at IS NULL')
        .execute();
    });
  }

  async changePassword(
    user: AuthenticatedUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    assertStrongPassword(newPassword);
    const persistedUser = await this.usersService.findByEmailWithPassword(
      user.email,
    );
    if (
      !persistedUser ||
      !(await bcrypt.compare(currentPassword, persistedUser.passwordHash))
    ) {
      throw new BadRequestException('La contraseña actual es incorrecta.');
    }
    if (await bcrypt.compare(newPassword, persistedUser.passwordHash)) {
      throw new BadRequestException(
        'La nueva contraseña debe ser diferente a la actual.',
      );
    }

    await this.usersService.updatePassword(
      user.id,
      await bcrypt.hash(newPassword, 12),
    );
    await this.revokeUserSessions(user.id, user.sessionId);
  }

  private async revokeUserSessions(
    userId: string,
    exceptTokenId?: string,
  ): Promise<void> {
    const query = this.sessionsRepository
      .createQueryBuilder()
      .update(AuthSession)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL');
    if (exceptTokenId)
      query.andWhere('token_id <> :exceptTokenId', { exceptTokenId });
    await query.execute();
  }

  /**
   * Crea una sesión escolar sólo mientras la fila del establecimiento está
   * bloqueada para lectura. La baja usa un bloqueo de escritura sobre esa misma
   * fila, por lo que necesariamente revocará esta sesión o se ejecutará antes y
   * hará fallar la validación de estado.
   */
  private createSchoolSessionIfActive(
    session: NewAuthSession,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const association = await manager.findOneBy(UserSchool, {
        userId: session.userId,
      });
      if (!association) return false;

      const school = await manager.getRepository(School).findOne({
        where: { id: association.schoolId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!school?.isActive) return false;

      // La asociación pudo cambiar mientras se esperaba el lock de la escuela.
      const currentAssociation = await manager.findOneBy(UserSchool, {
        userId: session.userId,
        schoolId: school.id,
      });
      if (!currentAssociation) return false;

      await manager.getRepository(AuthSession).save(session);
      return true;
    });
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
}
