import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuthSession } from '../../auth/entities/auth-session.entity';
import { assertStrongPassword } from '../../auth/utils/password-policy';
import { School } from '../../schools/entities/school.entity';
import { SchoolUserAssignmentHistory } from '../../schools/entities/school-user-assignment-history.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserRole } from '../entities/user-role.enum';
import { UserSchool } from '../entities/user-school.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class AdminUsersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(query: ListUsersQueryDto) {
    const builder = this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userSchools', 'association')
      .leftJoinAndSelect('association.school', 'school')
      .orderBy('user.lastName', 'ASC')
      .addOrderBy('user.firstName', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.search?.trim()) {
      builder.andWhere(
        `(LOWER(user.firstName) LIKE :search OR LOWER(user.lastName) LIKE :search OR LOWER(user.email) LIKE :search)`,
        { search: `%${query.search.trim().toLowerCase()}%` },
      );
    }
    if (query.role) builder.andWhere('user.role = :role', { role: query.role });
    if (query.isActive !== undefined) {
      builder.andWhere('user.isActive = :isActive', {
        isActive: query.isActive,
      });
    }
    if (query.schoolId) {
      builder.andWhere('association.schoolId = :schoolId', {
        schoolId: query.schoolId,
      });
    }

    const [users, total] = await builder.getManyAndCount();
    return {
      items: users.map((user) => this.toResponse(user)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.loadUser(id);
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return this.toResponse(user);
  }

  async listSchools() {
    const schools = await this.dataSource
      .getRepository(School)
      .find({ order: { name: 'ASC' } });
    return schools.map((school) => ({
      id: school.id,
      cue: school.cue,
      code: school.cue,
      name: school.name,
      isActive: school.isActive,
    }));
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser) {
    assertStrongPassword(dto.temporaryPassword);
    let userId: string;
    try {
      userId = await this.dataSource.transaction(async (manager) => {
        await this.assertUniqueEmail(manager, dto.email);
        const school = await this.resolveSchool(
          manager,
          dto.role,
          dto.schoolId,
        );
        const user = await manager.save(
          User,
          manager.create(User, {
            firstName: this.cleanName(dto.firstName),
            lastName: this.cleanName(dto.lastName),
            email: dto.email.trim().toLowerCase(),
            passwordHash: await bcrypt.hash(dto.temporaryPassword, 12),
            role: dto.role,
            isActive: dto.isActive ?? true,
            mustChangePassword: true,
            lastLoginAt: null,
            failedLoginAttempts: 0,
            lockedUntil: null,
          }),
        );
        if (school) {
          await manager.save(UserSchool, {
            userId: user.id,
            schoolId: school.id,
          });
          await this.assignmentHistory(
            manager,
            school.id,
            null,
            user.id,
            actor.id,
            'assigned',
          );
        }
        await this.audit(manager, actor.id, 'USER_CREATED', user.id, {
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          schoolId: school?.id ?? null,
          isActive: user.isActive,
          mustChangePassword: true,
        });
        return user.id;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Ya existe un usuario con ese correo.');
      }
      throw error;
    }
    return this.findOne(userId);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const user = await manager.getRepository(User).findOne({
          where: { id },
          relations: { userSchools: { school: true } },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user) throw new NotFoundException('Usuario no encontrado.');
        if (actor.id === id && dto.role && dto.role !== UserRole.Admin) {
          throw new ForbiddenException(
            'No podés quitarte tu propio rol administrador.',
          );
        }
        if (actor.id === id && dto.isActive === false) {
          throw new ForbiddenException('No podés bloquear tu propia cuenta.');
        }
        if (dto.email && dto.email.trim().toLowerCase() !== user.email) {
          await this.assertUniqueEmail(manager, dto.email, id);
        }

        const before = this.snapshot(user);
        const targetRole = dto.role ?? user.role;
        const currentSchoolId = user.userSchools[0]?.schoolId;
        const requestedSchoolId =
          targetRole === UserRole.Admin
            ? undefined
            : dto.schoolId === undefined
              ? currentSchoolId
              : (dto.schoolId ?? undefined);
        const school = await this.resolveSchool(
          manager,
          targetRole,
          requestedSchoolId,
          id,
        );

        user.firstName = dto.firstName
          ? this.cleanName(dto.firstName)
          : user.firstName;
        user.lastName = dto.lastName
          ? this.cleanName(dto.lastName)
          : user.lastName;
        user.email = dto.email ? dto.email.trim().toLowerCase() : user.email;
        user.role = targetRole;
        user.isActive = dto.isActive ?? user.isActive;
        await this.assertActiveAdministratorRemains(manager, user, before);
        await manager.save(User, user);
        await manager.delete(UserSchool, { userId: id });
        if (school)
          await manager.save(UserSchool, { userId: id, schoolId: school.id });
        if (currentSchoolId !== school?.id) {
          if (currentSchoolId)
            await this.assignmentHistory(
              manager,
              currentSchoolId,
              id,
              null,
              actor.id,
              'unassigned',
            );
          if (school)
            await this.assignmentHistory(
              manager,
              school.id,
              null,
              id,
              actor.id,
              'assigned',
            );
        }

        const after = { ...this.snapshot(user), schoolId: school?.id ?? null };
        const changes = this.diff(before, after);
        if (Object.keys(changes).length > 0) {
          await this.audit(manager, actor.id, 'USER_UPDATED', id, changes);
        }
        if (
          !user.isActive ||
          before.role !== user.role ||
          before.email !== user.email
        ) {
          await this.revokeSessions(
            manager,
            id,
            actor.id === id ? actor.sessionId : undefined,
          );
        }
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Ya existe un usuario con ese correo.');
      }
      throw error;
    }
    return this.findOne(id);
  }

  async setStatus(id: string, isActive: boolean, actor: AuthenticatedUser) {
    if (actor.id === id && !isActive) {
      throw new ForbiddenException('No podés bloquear tu propia cuenta.');
    }
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('Usuario no encontrado.');
      if (user.isActive === isActive) return;
      const before = this.snapshot(user);
      user.isActive = isActive;
      await this.assertActiveAdministratorRemains(manager, user, before);
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      await manager.save(User, user);
      if (!isActive) await this.revokeSessions(manager, id);
      await this.audit(
        manager,
        actor.id,
        isActive ? 'USER_UNBLOCKED' : 'USER_BLOCKED',
        id,
        { isActive: { from: !isActive, to: isActive } },
      );
    });
    return this.findOne(id);
  }

  async resetPassword(
    id: string,
    temporaryPassword: string,
    actor: AuthenticatedUser,
  ) {
    assertStrongPassword(temporaryPassword);
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOneBy(User, { id });
      if (!user) throw new NotFoundException('Usuario no encontrado.');
      await manager.update(User, id, {
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      await this.revokeSessions(manager, id);
      await this.audit(manager, actor.id, 'USER_PASSWORD_RESET', id, {
        mustChangePassword: { from: user.mustChangePassword, to: true },
        sessionsRevoked: true,
      });
    });
  }

  private async loadUser(id: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOne({
      where: { id },
      relations: { userSchools: { school: true } },
    });
  }

  private async assertUniqueEmail(
    manager: EntityManager,
    email: string,
    exceptId?: string,
  ) {
    const builder = manager
      .getRepository(User)
      .createQueryBuilder('user')
      .where('LOWER(user.email) = :email', {
        email: email.trim().toLowerCase(),
      });
    if (exceptId) builder.andWhere('user.id <> :exceptId', { exceptId });
    if (await builder.getExists())
      throw new ConflictException('Ya existe un usuario con ese correo.');
  }

  private async resolveSchool(
    manager: EntityManager,
    role: UserRole,
    schoolId?: string,
    exceptUserId?: string,
  ) {
    if (role === UserRole.Admin) {
      if (schoolId)
        throw new BadRequestException(
          'Un administrador no debe asociarse a un colegio.',
        );
      return null;
    }
    if (!schoolId)
      throw new BadRequestException(
        'El rol Colegio requiere un establecimiento asociado.',
      );
    const school = await manager.findOneBy(School, { id: schoolId });
    if (!school)
      throw new BadRequestException('El colegio seleccionado no existe.');
    const existingAssociation = await manager.findOneBy(UserSchool, {
      schoolId,
    });
    if (!school.isActive && existingAssociation?.userId !== exceptUserId)
      throw new BadRequestException('El colegio seleccionado está inactivo.');
    if (existingAssociation && existingAssociation.userId !== exceptUserId) {
      throw new ConflictException(
        'El colegio ya tiene un usuario asociado. Reemplazalo desde el detalle del colegio.',
      );
    }
    return school;
  }

  private async assertActiveAdministratorRemains(
    manager: EntityManager,
    user: User,
    before: Record<string, unknown>,
  ) {
    if (before.role !== UserRole.Admin || before.isActive !== true) return;
    if (user.role === UserRole.Admin && user.isActive) return;
    const remaining = await manager.countBy(User, {
      role: UserRole.Admin,
      isActive: true,
    });
    if (remaining <= 1)
      throw new BadRequestException(
        'Debe permanecer al menos un administrador activo.',
      );
  }

  private revokeSessions(
    manager: EntityManager,
    userId: string,
    exceptTokenId?: string,
  ) {
    const query = manager
      .createQueryBuilder()
      .update(AuthSession)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL');
    if (exceptTokenId)
      query.andWhere('token_id <> :exceptTokenId', { exceptTokenId });
    return query.execute();
  }

  private audit(
    manager: EntityManager,
    actorUserId: string,
    action: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    return manager.save(AuditLog, {
      actorUserId,
      action,
      entityType: 'User',
      entityId,
      changes,
    });
  }

  private assignmentHistory(
    manager: EntityManager,
    schoolId: string,
    previousUserId: string | null,
    newUserId: string | null,
    actorUserId: string,
    action: 'assigned' | 'unassigned',
  ) {
    return manager.save(SchoolUserAssignmentHistory, {
      schoolId,
      previousUserId,
      newUserId,
      actorUserId,
      action,
    });
  }

  private cleanName(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private snapshot(user: User) {
    return {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      schoolId: user.userSchools?.[0]?.schoolId ?? null,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    return Object.fromEntries(
      Object.keys(after)
        .filter((key) => before[key] !== after[key])
        .map((key) => [
          key,
          { from: before[key] ?? null, to: after[key] ?? null },
        ]),
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const databaseError = error as {
      code?: string;
      driverError?: { code?: string };
    };
    return (
      databaseError.code === '23505' ||
      databaseError.driverError?.code === '23505'
    );
  }

  private toResponse(user: User) {
    const association = user.userSchools?.[0];
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      school: association?.school
        ? {
            id: association.school.id,
            cue: association.school.cue,
            code: association.school.cue,
            name: association.school.name,
          }
        : null,
    };
  }
}
