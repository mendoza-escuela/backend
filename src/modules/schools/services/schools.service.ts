import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuthSession } from '../../auth/entities/auth-session.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { UserSchool } from '../../users/entities/user-school.entity';
import { User } from '../../users/entities/user.entity';
import { AssignSchoolUserDto } from '../dto/assign-school-user.dto';
import { CreateSchoolDto } from '../dto/create-school.dto';
import { ListSchoolsQueryDto } from '../dto/list-schools-query.dto';
import { UpdateSchoolDto } from '../dto/update-school.dto';
import { SchoolUserAssignmentHistory } from '../entities/school-user-assignment-history.entity';
import { School } from '../entities/school.entity';

@Injectable()
export class SchoolsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(query: ListSchoolsQueryDto) {
    const builder = this.filteredBuilder(query)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    const [items, total] = await builder.getManyAndCount();
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async filterOptions() {
    const [
      departments,
      localities,
      educationLevels,
      managementTypes,
      scopes,
      shifts,
    ] = await Promise.all([
      this.distinctValues('department'),
      this.distinctValues('locality'),
      this.distinctValues('educationLevel'),
      this.distinctValues('managementType'),
      this.distinctValues('scope'),
      this.distinctValues('shift'),
    ]);
    return {
      departments,
      localities,
      educationLevels,
      managementTypes,
      scopes,
      shifts,
    };
  }

  async findOne(id: string) {
    const school = await this.dataSource
      .getRepository(School)
      .findOneBy({ id });
    if (!school) throw new NotFoundException('Colegio no encontrado.');
    const users = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .innerJoin(
        'user.userSchools',
        'assignment',
        'assignment.schoolId = :id',
        { id },
      )
      .select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.role',
        'user.isActive',
        'user.lastLoginAt',
      ])
      .getMany();
    const userIds = users.map((user) => user.id);
    const accesses = userIds.length
      ? await this.dataSource
          .getRepository(AuthSession)
          .createQueryBuilder('session')
          .leftJoin('session.user', 'user')
          .select([
            'session.id',
            'session.userId',
            'session.createdAt',
            'session.expiresAt',
            'session.revokedAt',
            'user.firstName',
            'user.lastName',
            'user.email',
          ])
          .where('session.userId IN (:...userIds)', { userIds })
          .orderBy('session.createdAt', 'DESC')
          .take(20)
          .getMany()
      : [];
    const assignmentHistory = await this.dataSource
      .getRepository(SchoolUserAssignmentHistory)
      .find({
        where: { schoolId: id },
        relations: { previousUser: true, newUser: true, actorUser: true },
        order: { createdAt: 'DESC' },
        take: 50,
      });
    const audits = await this.dataSource.getRepository(AuditLog).find({
      where: { entityType: 'School', entityId: id },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return {
      ...school,
      users: users.map((user) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
      })),
      accesses,
      assignmentHistory: assignmentHistory.map((history) => ({
        id: history.id,
        action: history.action,
        createdAt: history.createdAt,
        previousUser: this.userSummary(history.previousUser),
        newUser: this.userSummary(history.newUser),
        actorUser: this.userSummary(history.actorUser),
      })),
      audits,
      campaigns: {
        available: false,
        items: [],
        message: 'El módulo de campañas aún no está implementado.',
      },
      evaluations: {
        available: false,
        items: [],
        message: 'El módulo de evaluaciones aún no está implementado.',
      },
      actions: {
        canEdit: true,
        canChangeStatus: true,
        canReplaceUser: true,
        canStartEvaluation: school.isActive,
      },
    };
  }

  async create(dto: CreateSchoolDto, actor: AuthenticatedUser) {
    const normalized = this.normalize(dto);
    this.validateCharacteristics(normalized.characteristics);
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        await this.assertCueUnique(manager, normalized.cue);
        const school = await manager.save(
          School,
          manager.create(School, normalized),
        );
        await this.audit(
          manager,
          actor.id,
          'SCHOOL_CREATED',
          school.id,
          this.snapshot(school),
        );
        return school.id;
      });
      return this.findOne(id);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(id: string, dto: UpdateSchoolDto, actor: AuthenticatedUser) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const school = await manager
          .getRepository(School)
          .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!school) throw new NotFoundException('Colegio no encontrado.');
        const before = this.snapshot(school);
        const normalized = this.normalize(dto);
        if (normalized.cue && normalized.cue !== school.cue)
          await this.assertCueUnique(manager, normalized.cue, id);
        if (normalized.characteristics)
          this.validateCharacteristics(normalized.characteristics);
        Object.assign(school, normalized);
        await manager.save(School, school);
        const changes = this.diff(before, this.snapshot(school));
        if (Object.keys(changes).length)
          await this.audit(manager, actor.id, 'SCHOOL_UPDATED', id, changes);
      });
      return this.findOne(id);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async setStatus(id: string, isActive: boolean, actor: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      const school = await manager
        .getRepository(School)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!school) throw new NotFoundException('Colegio no encontrado.');
      if (school.isActive === isActive) return;
      school.isActive = isActive;
      await manager.save(School, school);
      await this.audit(
        manager,
        actor.id,
        isActive ? 'SCHOOL_ACTIVATED' : 'SCHOOL_DEACTIVATED',
        id,
        {
          isActive: { from: !isActive, to: isActive },
          newEvaluationsAllowed: isActive,
        },
      );
    });
    return this.findOne(id);
  }

  /** Valida en backend que un colegio pueda iniciar una nueva evaluación. */
  async assertActiveForEvaluation(
    schoolId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const school = await manager.findOneBy(School, { id: schoolId });
    if (!school) throw new NotFoundException('Colegio no encontrado.');
    if (!school.isActive)
      throw new ConflictException(
        'El colegio está inactivo y no puede iniciar nuevas evaluaciones.',
      );
    return school;
  }

  async assignUser(
    id: string,
    dto: AssignSchoolUserDto,
    actor: AuthenticatedUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const school = await manager
        .getRepository(School)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!school) throw new NotFoundException('Colegio no encontrado.');
      const current = await manager.findOneBy(UserSchool, { schoolId: id });
      if (current?.userId === dto.userId) return;
      let next: User | null = null;
      if (dto.userId) {
        next = await manager.findOneBy(User, { id: dto.userId });
        if (!next || next.role !== UserRole.School)
          throw new BadRequestException(
            'Sólo puede asociarse un usuario con rol Colegio.',
          );
        if (!next.isActive)
          throw new BadRequestException(
            'El usuario seleccionado está bloqueado.',
          );
        const otherAssignment = await manager.findOneBy(UserSchool, {
          userId: next.id,
        });
        if (otherAssignment && otherAssignment.schoolId !== id)
          throw new ConflictException(
            'El usuario ya está asociado a otro colegio.',
          );
      }
      if (current) await manager.delete(UserSchool, { schoolId: id });
      if (next)
        await manager.save(UserSchool, { schoolId: id, userId: next.id });
      const action = !next ? 'unassigned' : current ? 'replaced' : 'assigned';
      await manager.save(SchoolUserAssignmentHistory, {
        schoolId: id,
        previousUserId: current?.userId ?? null,
        newUserId: next?.id ?? null,
        actorUserId: actor.id,
        action,
      });
      await this.audit(
        manager,
        actor.id,
        'SCHOOL_USER_' + action.toUpperCase(),
        id,
        { userId: { from: current?.userId ?? null, to: next?.id ?? null } },
      );
    });
    return this.findOne(id);
  }

  async export(
    query: ListSchoolsQueryDto,
    format: 'csv' | 'xlsx',
    actor: AuthenticatedUser,
  ) {
    const schools = await this.filteredBuilder(query).getMany();
    await this.dataSource.getRepository(AuditLog).save({
      actorUserId: actor.id,
      action: 'SCHOOLS_EXPORTED',
      entityType: 'School',
      entityId: null,
      changes: { format, count: schools.length, filters: query },
    });
    const headers = [
      'CUE',
      'Nombre',
      'Número',
      'Departamento',
      'Localidad',
      'Dirección',
      'Nivel',
      'Gestión',
      'Ámbito',
      'Jornada',
      'Correo',
      'Teléfono',
      'Referente',
      'Matrícula',
      'Estado',
    ];
    const rows = schools.map((school) => [
      school.cue,
      school.name,
      school.schoolNumber ?? '',
      school.department,
      school.locality,
      school.address,
      school.educationLevel,
      school.managementType,
      school.scope ?? '',
      school.shift ?? '',
      school.email ?? '',
      school.phone ?? '',
      `${school.referentLastName}, ${school.referentFirstName}`,
      school.enrollment,
      school.isActive ? 'Activo' : 'Inactivo',
    ]);
    if (format === 'csv')
      return {
        buffer: Buffer.from(
          '\uFEFF' +
            [headers, ...rows]
              .map((row) =>
                row.map((value) => this.csvCell(String(value))).join(','),
              )
              .join('\r\n'),
          'utf8',
        ),
        mime: 'text/csv; charset=utf-8',
        extension: 'csv',
      };
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Padrón');
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF000F9F' },
    };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = 20;
    });
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    };
  }

  private filteredBuilder(
    query: ListSchoolsQueryDto,
  ): SelectQueryBuilder<School> {
    const builder = this.dataSource
      .getRepository(School)
      .createQueryBuilder('school')
      .orderBy('school.name', 'ASC');
    if (query.search?.trim())
      builder.andWhere(
        "(LOWER(school.cue) LIKE :search OR LOWER(school.name) LIKE :search OR LOWER(COALESCE(school.schoolNumber, '')) LIKE :search)",
        { search: `%${query.search.trim().toLowerCase()}%` },
      );
    for (const key of [
      'department',
      'locality',
      'educationLevel',
      'managementType',
      'scope',
      'shift',
    ] as const)
      if (query[key])
        builder.andWhere(`school.${key} = :${key}`, { [key]: query[key] });
    if (query.isActive !== undefined)
      builder.andWhere('school.isActive = :isActive', {
        isActive: query.isActive,
      });
    return builder;
  }

  private async distinctValues(
    column:
      | 'department'
      | 'locality'
      | 'educationLevel'
      | 'managementType'
      | 'scope'
      | 'shift',
  ) {
    const rows = await this.dataSource
      .getRepository(School)
      .createQueryBuilder('school')
      .select(`DISTINCT school.${column}`, 'value')
      .where(`school.${column} IS NOT NULL`)
      .andWhere(`school.${column} <> ''`)
      .orderBy(`school.${column}`, 'ASC')
      .getRawMany<{ value: string }>();
    return rows.map((row) => row.value);
  }

  private normalize<T extends CreateSchoolDto | UpdateSchoolDto>(dto: T) {
    const normalized = { ...dto } as Record<string, unknown>;
    if (typeof normalized.cue === 'string')
      normalized.cue = normalized.cue.toUpperCase();
    for (const key of ['email', 'referentEmail'])
      if (typeof normalized[key] === 'string')
        normalized[key] = normalized[key].toLowerCase();
    for (const key of [
      'schoolNumber',
      'postalCode',
      'scope',
      'shift',
      'phone',
      'email',
      'referentEmail',
      'referentPhone',
    ])
      if (normalized[key] === undefined) delete normalized[key];
    return normalized as T;
  }

  private validateCharacteristics(value: Record<string, unknown> | undefined) {
    if (!value) return;
    const entries = Object.entries(value);
    if (
      entries.length > 30 ||
      entries.some(
        ([key, item]) =>
          key.length > 80 ||
          ['__proto__', 'prototype', 'constructor'].includes(key) ||
          (!['string', 'number', 'boolean'].includes(typeof item) &&
            item !== null),
      )
    )
      throw new BadRequestException(
        'Las características deben contener hasta 30 valores simples.',
      );
  }

  private async assertCueUnique(
    manager: EntityManager,
    cue: string,
    exceptId?: string,
  ) {
    const builder = manager
      .getRepository(School)
      .createQueryBuilder('school')
      .where('LOWER(school.cue) = :cue', { cue: cue.toLowerCase() });
    if (exceptId) builder.andWhere('school.id <> :exceptId', { exceptId });
    if (await builder.getExists())
      throw new ConflictException('Ya existe un colegio con ese CUE.');
  }
  private snapshot(school: School) {
    return {
      cue: school.cue,
      name: school.name,
      schoolNumber: school.schoolNumber,
      department: school.department,
      locality: school.locality,
      address: school.address,
      postalCode: school.postalCode,
      educationLevel: school.educationLevel,
      managementType: school.managementType,
      scope: school.scope,
      shift: school.shift,
      phone: school.phone,
      email: school.email,
      referentFirstName: school.referentFirstName,
      referentLastName: school.referentLastName,
      referentEmail: school.referentEmail,
      referentPhone: school.referentPhone,
      enrollment: school.enrollment,
      characteristics: school.characteristics,
      isActive: school.isActive,
    };
  }
  private diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    return Object.fromEntries(
      Object.keys(after)
        .filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
        )
        .map((key) => [
          key,
          { from: before[key] ?? null, to: after[key] ?? null },
        ]),
    );
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
      entityType: 'School',
      entityId,
      changes,
    });
  }
  private rethrowUnique(error: unknown): never {
    const db = error as { code?: string; driverError?: { code?: string } };
    if (db?.code === '23505' || db?.driverError?.code === '23505')
      throw new ConflictException('Ya existe un colegio con ese CUE.');
    throw error;
  }
  private userSummary(user: User | null) {
    return user
      ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        }
      : null;
  }
  private csvCell(value: string) {
    const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safeValue)
      ? `"${safeValue.replace(/"/g, '""')}"`
      : safeValue;
  }
}
