import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, EntityTarget } from 'typeorm';
import { UserRole } from '../../users/entities/user-role.enum';
import { User } from '../../users/entities/user.entity';
import { AdminUsersService } from '../../users/services/admin-users.service';
import { School } from '../entities/school.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SchoolRectification } from '../entities/school-rectification.entity';
import { EducationLevelCatalog } from '../entities/education-level-catalog.entity';
import { SchoolEducationLevel } from '../entities/school-education-level.entity';
import { SchoolRectificationEducationLevel } from '../entities/school-rectification-education-level.entity';
import { SchoolShiftCatalog } from '../entities/school-shift-catalog.entity';
import { SchoolContactType } from '../entities/school-contact.entity';
import { SchoolUserAssignmentHistory } from '../entities/school-user-assignment-history.entity';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { SchoolsService } from './schools.service';

function campaignParticipationBuilder(rows: Array<Record<string, unknown>>) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('SchoolsService pagination', () => {
  it('pagina el padrón en base de datos y devuelve sólo campos del listado', async () => {
    const builder = {
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 45]),
    };
    const getRepository = jest.fn(() => ({
      createQueryBuilder: jest.fn(() => builder),
    }));
    const dataSource = { getRepository } as unknown as DataSource;

    const response = await new SchoolsService(dataSource).list({
      page: 2,
      limit: 20,
    });

    expect(builder.select).toHaveBeenCalledWith(
      expect.arrayContaining(['school.id', 'school.name']),
    );
    expect(builder.skip).toHaveBeenCalledWith(20);
    expect(builder.take).toHaveBeenCalledWith(20);
    expect(response.pagination).toEqual({
      page: 2,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it('pagina en backend sólo usuarios disponibles para asociación', async () => {
    const users = [
      {
        id: 'user-id',
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
        isActive: true,
        userSchools: [
          {
            schoolId: 'other-school-id',
            school: {
              id: 'other-school-id',
              cue: '500000001',
              name: 'Escuela anterior',
            },
          },
        ],
      },
    ] as User[];
    const builder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([users, 21]),
    };
    const dataSource = {
      getRepository: jest.fn((entity) =>
        entity === School
          ? { existsBy: jest.fn().mockResolvedValue(true) }
          : { createQueryBuilder: jest.fn(() => builder) },
      ),
    } as unknown as DataSource;

    const response = await new SchoolsService(dataSource).listAssignableUsers(
      'school-id',
      { search: 'ana', page: 2, limit: 20 },
    );

    expect(builder.where).toHaveBeenCalledWith('user.role = :role', {
      role: UserRole.School,
    });
    expect(builder.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('assignment.userId IS NULL'),
      expect.anything(),
    );
    expect(builder.orderBy).toHaveBeenCalledWith('user.lastName', 'ASC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('user.firstName', 'ASC');
    expect(builder.skip).toHaveBeenCalledWith(20);
    expect(builder.take).toHaveBeenCalledWith(20);
    expect(response.items[0].assignedSchool).toEqual({
      id: 'other-school-id',
      cue: '500000001',
      name: 'Escuela anterior',
    });
    expect(response.pagination.totalPages).toBe(2);
  });
});

describe('SchoolsService administrative detail readiness', () => {
  it('no habilita iniciar una evaluación si la confirmación requiere actualización', async () => {
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      isActive: true,
      shiftCatalog: null,
      structuredEducationLevels: [],
      contacts: [],
    } as unknown as School;
    const rectification = {
      id: 'rectification-id',
      periodYear: Number(
        new Intl.DateTimeFormat('en', {
          timeZone: 'America/Argentina/Mendoza',
          year: 'numeric',
        }).format(new Date()),
      ),
      rectifiedAt: new Date('2026-08-10T12:00:00.000Z'),
      actorUser: null,
      snapshot: {
        name: 'Escuela Uno',
        cue: '500012300',
        directorName: 'Ana Pérez',
        department: 'Capital',
        address: 'Calle 1',
        locality: 'Mendoza',
        scope: 'Urbano',
        educationLevel: 'Educación común',
        shift: 'Simple',
        shiftCatalog: { id: 'shift-id', code: 'simple', label: 'Simple' },
        educationLevels: [
          {
            id: 'level-id',
            code: 'primario',
            label: 'Primario',
            enrollment: null,
          },
        ],
        hasKiosk: null,
        hasFoodService: true,
      },
    } as SchoolRectification;
    const userBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const participationBuilder = campaignParticipationBuilder([]);
    const dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === School)
          return { findOne: jest.fn().mockResolvedValue(school) };
        if (entity === User)
          return { createQueryBuilder: jest.fn(() => userBuilder) };
        if (entity === SchoolRectification)
          return { find: jest.fn().mockResolvedValue([rectification]) };
        if (entity === CampaignSchool)
          return {
            createQueryBuilder: jest.fn(() => participationBuilder),
          };
        if (entity === SchoolUserAssignmentHistory || entity === AuditLog)
          return { find: jest.fn().mockResolvedValue([]) };
        throw new Error('Repositorio inesperado');
      }),
    } as unknown as DataSource;

    const detail = await new SchoolsService(dataSource).findOne(school.id);

    expect(detail.rectification).toMatchObject({
      isConfirmed: true,
      isEvaluationReady: false,
      isRectified: false,
      rectifiedAt: rectification.rectifiedAt,
      missingFields: [{ code: 'hasKiosk', label: 'Kiosco' }],
    });
    expect(detail.actions.canStartEvaluation).toBe(false);
    expect(detail.campaigns).toEqual({
      available: true,
      items: [],
      message: 'El colegio no tiene asignaciones de etapa vigentes.',
    });
    expect(detail.evaluations).toEqual({
      available: true,
      items: [],
      message: 'No hay resultados de evaluación disponibles.',
    });
  });

  it('integra etapas, presentaciones y resultados sin consultas por fila', async () => {
    const rows = [
      {
        assignmentId: 'assignment-submitted',
        assignmentSource: 'manual',
        assignedAt: new Date('2026-08-02T12:00:00.000Z'),
        campaignId: 'campaign-submitted',
        campaignName: 'Etapa enviada',
        campaignType: 'annual',
        campaignStatus: 'closed',
        campaignStartsAt: new Date('2026-08-01T03:00:00.000Z'),
        campaignEndsAt: new Date('2026-08-31T02:59:59.999Z'),
        submissionId: 'submission-submitted',
        submissionStatus: 'submitted',
        submissionStartedAt: new Date('2026-08-03T10:00:00.000Z'),
        submissionLastSavedAt: new Date('2026-08-10T10:00:00.000Z'),
        submissionSubmittedAt: new Date('2026-08-10T11:00:00.000Z'),
        resultId: 'result-id',
        resultCalculatedAt: new Date('2026-08-10T11:01:00.000Z'),
        resultGeneralScore: '87.50000000',
        resultStars: '4',
      },
      {
        assignmentId: 'assignment-draft',
        assignmentSource: 'filter',
        assignedAt: '2025-08-02T12:00:00.000Z',
        campaignId: 'campaign-draft',
        campaignName: 'Etapa en borrador',
        campaignType: 'annual',
        campaignStatus: 'active',
        campaignStartsAt: '2025-08-01T03:00:00.000Z',
        campaignEndsAt: '2025-08-31T02:59:59.999Z',
        submissionId: 'submission-draft',
        submissionStatus: 'draft',
        submissionStartedAt: '2025-08-03T10:00:00.000Z',
        submissionLastSavedAt: null,
        submissionSubmittedAt: null,
        resultId: null,
        resultCalculatedAt: null,
        resultGeneralScore: null,
        resultStars: null,
      },
      {
        assignmentId: 'assignment-not-started',
        assignmentSource: 'bulk',
        assignedAt: '2024-08-02T12:00:00.000Z',
        campaignId: 'campaign-not-started',
        campaignName: 'Etapa no iniciada',
        campaignType: 'annual',
        campaignStatus: 'archived',
        campaignStartsAt: '2024-08-01T03:00:00.000Z',
        campaignEndsAt: '2024-08-31T02:59:59.999Z',
        submissionId: null,
        submissionStatus: null,
        submissionStartedAt: null,
        submissionLastSavedAt: null,
        submissionSubmittedAt: null,
        resultId: null,
        resultCalculatedAt: null,
        resultGeneralScore: null,
        resultStars: null,
      },
    ];
    const builder = campaignParticipationBuilder(rows);
    const getRepository = jest.fn(() => ({
      createQueryBuilder: jest.fn(() => builder),
    }));
    const dataSource = { getRepository } as unknown as DataSource;
    const service = new SchoolsService(dataSource);

    const participation = await (
      service as unknown as {
        schoolCampaignParticipation: (schoolId: string) => Promise<{
          campaigns: {
            available: boolean;
            message: string;
            items: Array<Record<string, unknown>>;
          };
          evaluations: {
            available: boolean;
            message: string;
            items: Array<Record<string, unknown>>;
          };
        }>;
      }
    ).schoolCampaignParticipation('school-id');

    expect(builder.andWhere).toHaveBeenCalledWith(
      'assignment.removedAt IS NULL',
    );
    expect(builder.orderBy).toHaveBeenCalledWith('campaign.startsAt', 'DESC');
    expect(participation.campaigns).toMatchObject({
      available: true,
      message: '',
      items: [
        {
          assignment: {
            id: 'assignment-submitted',
            source: 'manual',
            assignedAt: '2026-08-02T12:00:00.000Z',
          },
          campaign: {
            id: 'campaign-submitted',
            name: 'Etapa enviada',
            startsAt: '2026-08-01T03:00:00.000Z',
          },
          participationStatus: 'submitted',
          submission: {
            id: 'submission-submitted',
            status: 'submitted',
            submittedAt: '2026-08-10T11:00:00.000Z',
          },
          result: {
            available: true,
            id: 'result-id',
            calculatedAt: '2026-08-10T11:01:00.000Z',
          },
        },
        expect.objectContaining({
          participationStatus: 'draft',
          result: { available: false, id: null, calculatedAt: null },
        }),
        expect.objectContaining({
          participationStatus: 'not_started',
          submission: null,
        }),
      ],
    });
    expect(participation.evaluations).toEqual({
      available: true,
      message: '',
      items: [
        {
          id: 'result-id',
          campaignId: 'campaign-submitted',
          submissionId: 'submission-submitted',
          calculatedAt: '2026-08-10T11:01:00.000Z',
          generalScore: 87.5,
          stars: 4,
        },
      ],
    });
    expect(getRepository).toHaveBeenCalledTimes(1);
  });
});

describe('SchoolsService rectification catalogs', () => {
  it('combina catálogos persistidos con los valores estáticos oficiales', async () => {
    const shifts = [{ id: 'shift', code: 'simple', label: 'Simple' }];
    const levels = [{ id: 'level', code: 'inicial', label: 'Inicial' }];
    const dataSource = {
      getRepository: jest.fn((entity) => ({
        find: jest
          .fn()
          .mockResolvedValue(entity === SchoolShiftCatalog ? shifts : levels),
      })),
    } as unknown as DataSource;

    const catalogs = await new SchoolsService(
      dataSource,
    ).rectificationCatalogs();

    expect(catalogs.shifts.items).toEqual(shifts);
    expect(catalogs.educationLevels.items).toEqual(levels);
    expect(catalogs.managementTypes).toEqual([
      { code: 'estatal', label: 'Estatal' },
      { code: 'privado', label: 'Privado' },
    ]);
    expect(catalogs.scopes.map(({ label }) => label)).toEqual([
      'Urbano',
      'Urbano Marginal',
      'Marginal',
      'Marginal rural',
      'Rural',
      'Rural de frontera',
    ]);
    expect(catalogs.educationTypes.map(({ label }) => label)).toContain(
      'Educación permanente de jóvenes y adultos',
    );
    expect(catalogs.characteristics).toContainEqual({
      code: 'isMultigrade',
      label: 'Plurogrado',
    });
  });
});

describe('SchoolsService structured admin writes', () => {
  it('valida y persiste jornada, niveles y banderas en una edición administrativa', async () => {
    const shift = {
      id: '8bbdded8-8980-4a27-a1dc-95d39362f510',
      code: 'simple',
      label: 'Simple',
      isActive: true,
      order: 0,
    } as SchoolShiftCatalog;
    const level = {
      id: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
      code: 'primario',
      label: 'Primario',
      isActive: true,
      order: 0,
    } as EducationLevelCatalog;
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      shift: 'Dato heredado',
      shiftCatalogId: null,
      characteristics: {
        legacyFeature: 'conservar',
        isMultigrade: true,
      },
    } as School;
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === School
          ? { findOne: jest.fn().mockResolvedValue(school) }
          : {},
      ),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(shift),
      findBy: jest.fn().mockResolvedValue([level]),
      create: jest.fn(
        (_entity: EntityTarget<unknown>, value: Record<string, unknown>) =>
          value,
      ),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn((_entity, value) => Promise.resolve(value)),
    };
    const transaction = jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    );
    const dataSource = { transaction } as unknown as DataSource;
    const service = new SchoolsService(dataSource);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: school.id } as never);

    await service.update(
      school.id,
      {
        shiftCatalogId: shift.id,
        educationLevels: [{ levelId: level.id, enrollment: 25 }],
        hasKiosk: false,
        hasFoodService: true,
        isBoarding: false,
        characteristics: {
          isMultigrade: null,
          isInterculturalBilingual: false,
        },
        contacts: [
          {
            type: SchoolContactType.Respondent,
            firstName: 'Ana',
            lastName: 'Pérez',
            position: 'Directora',
            phone: '2615551111',
            email: 'ana@example.edu.ar',
          },
        ],
      },
      { id: 'actor-id' } as never,
    );

    expect(school).toMatchObject({
      shiftCatalogId: shift.id,
      shift: 'Simple',
      hasKiosk: false,
      hasFoodService: true,
      isBoarding: false,
      characteristics: {
        legacyFeature: 'conservar',
        isMultigrade: null,
        isInterculturalBilingual: false,
      },
    });
    expect(manager.delete).toHaveBeenCalledWith(SchoolEducationLevel, {
      schoolId: school.id,
    });
    expect(manager.save).toHaveBeenCalledWith(
      SchoolEducationLevel,
      expect.arrayContaining([
        expect.objectContaining({ levelId: level.id, enrollment: 25 }),
      ]),
    );
    const audit = manager.save.mock.calls.find(
      ([entity]) => entity === AuditLog,
    )?.[1] as AuditLog | undefined;
    expect(audit).toMatchObject({
      action: 'SCHOOL_UPDATED',
      changes: {
        shiftCatalog: {
          from: null,
          to: { id: shift.id, code: shift.code, label: shift.label },
        },
        educationLevels: {
          from: [],
          to: [
            {
              id: level.id,
              code: level.code,
              label: level.label,
              enrollment: 25,
            },
          ],
        },
        contacts: {
          from: [],
          to: [
            expect.objectContaining({
              type: SchoolContactType.Respondent,
              firstName: 'Ana',
              lastName: 'Pérez',
            }),
          ],
        },
      },
    });
  });

  it('incluye las relaciones estructuradas en la auditoría de creación', async () => {
    const shift = {
      id: '8bbdded8-8980-4a27-a1dc-95d39362f510',
      code: 'simple',
      label: 'Simple',
      isActive: true,
      order: 0,
    } as SchoolShiftCatalog;
    const level = {
      id: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
      code: 'primario',
      label: 'Primario',
      isActive: true,
      order: 0,
    } as EducationLevelCatalog;
    const cueQuery = {
      where: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
    };
    let savedAudit: Partial<AuditLog> | undefined;
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === School
          ? { createQueryBuilder: jest.fn(() => cueQuery) }
          : {},
      ),
      findOneBy: jest.fn().mockResolvedValue(shift),
      findBy: jest.fn().mockResolvedValue([level]),
      create: jest.fn(
        (entity: EntityTarget<unknown>, value: Record<string, unknown>) =>
          entity === School ? { id: 'new-school-id', ...value } : value,
      ),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn((entity: EntityTarget<unknown>, value: unknown) => {
        if (entity === AuditLog) savedAudit = value as Partial<AuditLog>;
        return Promise.resolve(value);
      }),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager as unknown as EntityManager),
      ),
    } as unknown as DataSource;
    const createInTransaction = jest.fn().mockResolvedValue({
      id: 'responsible-user-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.edu.ar',
    });
    const sendInvitation = jest.fn().mockResolvedValue(true);
    const service = new SchoolsService(dataSource, {
      createInTransaction,
      sendInvitation,
    } as unknown as AdminUsersService);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 'new-school-id' } as never);

    const created = await service.create(
      {
        cue: '500012300',
        name: 'Escuela Uno',
        directorName: 'Ana Pérez',
        department: 'Capital',
        locality: 'Mendoza',
        address: 'San Martín 100',
        educationLevel: 'Educación común',
        managementType: 'Estatal',
        scope: 'Urbano',
        shift: 'Simple',
        shiftCatalogId: shift.id,
        educationLevels: [{ levelId: level.id, enrollment: null }],
        referentFirstName: 'Ana',
        referentLastName: 'Pérez',
        referentEmail: 'ana@example.edu.ar',
        enrollment: null,
        contacts: [
          {
            type: SchoolContactType.Respondent,
            firstName: 'Ana',
            lastName: 'Pérez',
            position: 'Directora',
          },
        ],
      },
      { id: 'actor-id' } as never,
    );

    expect(savedAudit).toMatchObject({
      action: 'SCHOOL_CREATED',
      changes: {
        shiftCatalog: { id: shift.id, code: shift.code, label: shift.label },
        educationLevels: [
          {
            id: level.id,
            code: level.code,
            label: level.label,
            enrollment: null,
          },
        ],
        contacts: [
          expect.objectContaining({
            type: SchoolContactType.Respondent,
            firstName: 'Ana',
            lastName: 'Pérez',
          }),
        ],
      },
    });
    expect(createInTransaction).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.edu.ar',
        role: UserRole.School,
        schoolId: 'new-school-id',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Jest tipa los asymmetric matchers como any.
        temporaryPassword: expect.stringMatching(
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/,
        ),
      }),
      { id: 'actor-id' },
    );
    expect(sendInvitation).toHaveBeenCalledWith(
      'responsible-user-id',
      expect.objectContaining({ email: 'ana@example.edu.ar' }),
    );
    expect(created).toMatchObject({
      id: 'new-school-id',
      responsibleUserInvitationEmailSent: true,
    });
  });
});

describe('SchoolsService annual rectification', () => {
  const shiftId = '8bbdded8-8980-4a27-a1dc-95d39362f510';
  const levelId = 'c6a0ca01-6db2-44a0-a841-9426c33ee88c';
  const activeShift = {
    id: shiftId,
    code: 'simple',
    label: 'Simple',
    isActive: true,
    order: 0,
  } as SchoolShiftCatalog;
  const activeLevel = {
    id: levelId,
    code: 'primario',
    label: 'Primario',
    isActive: true,
    order: 0,
  } as EducationLevelCatalog;
  const completeDto = (overrides: Record<string, unknown> = {}) => ({
    cue: '500012300',
    name: 'Escuela Uno',
    directorName: 'Ana Pérez',
    department: 'Capital',
    address: 'Calle 1',
    locality: 'Mendoza',
    scope: 'Urbano',
    educationLevel: 'Educación común',
    managementType: 'Estatal',
    hasKiosk: false,
    hasFoodService: true,
    shiftCatalogId: shiftId,
    educationLevels: [{ levelId, enrollment: null }],
    ...overrides,
  });

  it('updates mandatory data and stores a snapshot with actor and period', async () => {
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Directora Anterior',
      address: 'Calle 1',
      locality: 'Mendoza',
      department: 'Capital',
      managementType: 'Estatal',
      scope: 'Urbano',
      educationLevel: 'Educación común',
      shift: 'Simple',
      characteristics: {},
      hasKiosk: null,
      hasFoodService: null,
      isBoarding: null,
    } as School;
    let savedRectification: Partial<SchoolRectification> | undefined;
    let savedAudit: Partial<AuditLog> | undefined;
    const save = jest.fn((entity: EntityTarget<unknown>, value: unknown) => {
      if (entity === SchoolRectification)
        savedRectification = value as Partial<SchoolRectification>;
      if (entity === AuditLog) savedAudit = value as Partial<AuditLog>;
      return Promise.resolve(
        entity === SchoolRectification
          ? { ...(value as object), id: 'rectification-id' }
          : value,
      );
    });
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === School
          ? { findOne: jest.fn().mockResolvedValue(school) }
          : {},
      ),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(activeShift),
      findBy: jest.fn().mockResolvedValue([activeLevel]),
      create: jest.fn(
        (_entity: EntityTarget<unknown>, value: Record<string, unknown>) =>
          value,
      ),
      delete: jest.fn(),
      save,
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager as unknown as EntityManager),
      ),
    } as unknown as DataSource;
    const service = new SchoolsService(dataSource);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 'school-id' } as never);

    await service.rectify(
      'school-id',
      completeDto({
        directorName: 'María González',
        address: 'Calle 2',
      }),
      { id: 'actor-id' } as never,
    );

    expect(savedRectification?.schoolId).toBe('school-id');
    expect(savedRectification?.actorUserId).toBe('actor-id');
    expect(savedRectification?.periodYear).toEqual(expect.any(Number));
    expect(savedRectification?.snapshot).toMatchObject({
      directorName: 'María González',
      address: 'Calle 2',
    });
    expect(savedAudit).toMatchObject({
      action: 'SCHOOL_RECTIFIED',
      actorUserId: 'actor-id',
    });
  });

  it('permite al admin rectificar una escuela inactiva y conserva un snapshot autocontenido', async () => {
    const updatedAt = new Date('2026-07-29T12:00:00.000Z');
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Ana Pérez',
      department: 'Capital',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Educación común',
      managementType: 'Estatal',
      schoolNumber: '1-000',
      postalCode: '5500',
      phone: null,
      email: 'anterior@example.edu.ar',
      shift: 'Dato heredado',
      shiftCatalogId: null,
      enrollment: null,
      hasKiosk: null,
      hasFoodService: null,
      isBoarding: null,
      characteristics: {
        isMultigrade: true,
        isInterculturalBilingual: true,
      },
      isActive: false,
      updatedAt,
    } as School;
    const shift = {
      id: '8bbdded8-8980-4a27-a1dc-95d39362f510',
      code: 'jornada_completa',
      label: 'Jornada completa',
      isActive: true,
      order: 0,
    } as SchoolShiftCatalog;
    const levels = [
      {
        id: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
        code: 'primario',
        label: 'Primario',
        isActive: true,
        order: 0,
      },
      {
        id: 'a76d64ae-45f7-4f72-895e-7bdd9a11ce7d',
        code: 'secundario',
        label: 'Secundario',
        isActive: true,
        order: 1,
      },
    ] as EducationLevelCatalog[];
    let savedSnapshot: SchoolRectification['snapshot'] | undefined;
    let savedAudit: Partial<AuditLog> | undefined;
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === School
          ? { findOne: jest.fn().mockResolvedValue(school) }
          : {},
      ),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(shift),
      findBy: jest.fn().mockResolvedValue(levels),
      create: jest.fn(
        (_entity: EntityTarget<unknown>, value: Record<string, unknown>) =>
          value,
      ),
      delete: jest.fn(),
      save: jest.fn((entity, value) => {
        if (entity === SchoolRectification)
          savedSnapshot = (value as SchoolRectification).snapshot;
        if (entity === AuditLog) savedAudit = value as Partial<AuditLog>;
        return Promise.resolve(value);
      }),
    };
    const transaction = jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    );
    const dataSource = { transaction } as unknown as DataSource;
    const service = new SchoolsService(dataSource);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: school.id } as never);

    await service.rectifyAsAdmin(
      school.id,
      completeDto({
        schoolNumber: ' 1-001 ',
        postalCode: null,
        phone: ' 261 555 0000 ',
        email: null,
        hasKiosk: false,
        hasFoodService: true,
        isBoarding: false,
        shiftCatalogId: shift.id,
        enrollment: 0,
        educationLevels: [
          { levelId: levels[0].id, enrollment: 0 },
          { levelId: levels[1].id, enrollment: null },
        ],
        expectedUpdatedAt: updatedAt.toISOString(),
        characteristics: {
          isMultigrade: null,
          isInterculturalBilingual: false,
        },
      }),
      { id: 'actor-id', role: UserRole.Admin } as never,
    );

    expect(manager.delete).toHaveBeenCalledWith(SchoolEducationLevel, {
      schoolId: school.id,
    });
    expect(manager.save).toHaveBeenCalledWith(
      SchoolRectificationEducationLevel,
      expect.arrayContaining([
        expect.objectContaining({
          levelCode: 'primario',
          levelLabel: 'Primario',
          enrollment: 0,
        }),
      ]),
    );
    expect(savedSnapshot).toMatchObject({
      schemaVersion: 4,
      schoolNumber: '1-001',
      postalCode: null,
      phone: '261 555 0000',
      email: null,
      hasKiosk: false,
      hasFoodService: true,
      isBoarding: false,
      characteristics: {
        isMultigrade: null,
        isInterculturalBilingual: false,
      },
      enrollmentTotal: 0,
      shiftCatalog: {
        code: 'jornada_completa',
        label: 'Jornada completa',
      },
      educationLevels: [
        { code: 'primario', label: 'Primario', enrollment: 0 },
        { code: 'secundario', label: 'Secundario', enrollment: null },
      ],
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(savedAudit).toMatchObject({
      action: 'SCHOOL_RECTIFIED',
      changes: {
        changes: {
          schoolNumber: { from: '1-000', to: '1-001' },
          postalCode: { from: '5500', to: null },
          phone: { from: null, to: '261 555 0000' },
          email: { from: 'anterior@example.edu.ar', to: null },
        },
        snapshot: {
          schoolNumber: '1-001',
          postalCode: null,
          phone: '261 555 0000',
          email: null,
        },
      },
    });

    shift.label = 'Nombre nuevo';
    levels[0].label = 'Etiqueta nueva';
    school.hasKiosk = true;
    expect(savedSnapshot?.shiftCatalog?.label).toBe('Jornada completa');
    expect(savedSnapshot?.educationLevels?.[0].label).toBe('Primario');
    expect(savedSnapshot?.hasKiosk).toBe(false);
  });

  it('rechaza la rectificación escolar inactiva después de tomar el lock', async () => {
    const school = { id: 'school-id', isActive: false } as School;
    const findOne = jest.fn().mockResolvedValue(school);
    const manager = {
      getRepository: jest.fn(() => ({ findOne })),
      save: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager as unknown as EntityManager),
      ),
    } as unknown as DataSource;

    await expect(
      new SchoolsService(dataSource).rectify(school.id, completeDto(), {
        id: 'school-user-id',
        role: UserRole.School,
      } as never),
    ).rejects.toThrow('inactivo');

    expect(findOne).toHaveBeenCalledWith({
      where: { id: school.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rechaza niveles duplicados y conflictos de concurrencia', async () => {
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Ana Pérez',
      department: 'Capital',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Educación común',
      managementType: 'Estatal',
      shift: 'Dato heredado',
      shiftCatalogId: null,
      characteristics: {},
      updatedAt: new Date('2026-07-29T12:00:00.000Z'),
    } as School;
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(school),
      })),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(activeShift),
      findBy: jest.fn().mockResolvedValue([activeLevel]),
      save: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    };
    const transaction = jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    );
    const dataSource = { transaction } as unknown as DataSource;
    const service = new SchoolsService(dataSource);
    const baseDto = completeDto();

    await expect(
      service.rectify(
        school.id,
        {
          ...baseDto,
          educationLevels: [
            {
              levelId: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
              enrollment: 20,
            },
            {
              levelId: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
              enrollment: null,
            },
          ],
        },
        { id: 'actor-id' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    transaction.mockClear();
    manager.find.mockClear();
    manager.findOneBy.mockClear();
    manager.findBy.mockClear();
    manager.save.mockClear();
    manager.delete.mockClear();
    manager.update.mockClear();
    await expect(
      service.rectifyAsAdmin(
        school.id,
        {
          ...baseDto,
          schoolNumber: '1-001',
          expectedUpdatedAt: '2026-07-29T13:00:00.000Z',
        },
        { id: 'actor-id' } as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.find).not.toHaveBeenCalled();
    expect(manager.findOneBy).not.toHaveBeenCalled();
    expect(manager.findBy).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('rechaza jornadas y niveles inexistentes o inactivos', async () => {
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Ana Pérez',
      department: 'Capital',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Educación común',
      managementType: 'Estatal',
      shift: 'Dato heredado',
      shiftCatalogId: null,
      characteristics: {},
      updatedAt: new Date(),
    } as School;
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(school),
      })),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(activeShift),
      findBy: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager as unknown as EntityManager),
      ),
    } as unknown as DataSource;
    const service = new SchoolsService(dataSource);
    const baseDto = completeDto();

    manager.findOneBy.mockResolvedValueOnce(null);
    await expect(
      service.rectify(school.id, { ...baseDto, shiftCatalogId: shiftId }, {
        id: 'actor-id',
      } as never),
    ).rejects.toThrow('no existe');

    manager.findOneBy.mockResolvedValueOnce({
      id: shiftId,
      label: 'Jornada inactiva',
      isActive: false,
    });
    await expect(
      service.rectify(school.id, { ...baseDto, shiftCatalogId: shiftId }, {
        id: 'actor-id',
      } as never),
    ).rejects.toThrow('inactiva');

    manager.findBy.mockResolvedValueOnce([]);
    await expect(
      service.rectify(
        school.id,
        {
          ...baseDto,
          educationLevels: [{ levelId, enrollment: null }],
        },
        { id: 'actor-id' } as never,
      ),
    ).rejects.toThrow('no existe');

    manager.findBy.mockResolvedValueOnce([
      {
        id: levelId,
        label: 'Nivel inactivo',
        isActive: false,
      },
    ]);
    await expect(
      service.rectify(
        school.id,
        {
          ...baseDto,
          educationLevels: [{ levelId, enrollment: null }],
        },
        { id: 'actor-id' } as never,
      ),
    ).rejects.toThrow('inactivo');
  });

  it('propaga el rechazo transaccional si falla una escritura administrativa', async () => {
    const persistenceError = new Error('falló la persistencia');
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Ana Pérez',
      department: 'Capital',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Educación común',
      managementType: 'Estatal',
      shift: 'Simple',
      shiftCatalogId: null,
      characteristics: {},
      updatedAt: new Date('2026-07-29T12:00:00.000Z'),
    } as School;
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(school),
      })),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(activeShift),
      findBy: jest.fn().mockResolvedValue([activeLevel]),
      save: jest.fn().mockRejectedValue(persistenceError),
    };
    let transactionRejected = false;
    const transaction = jest.fn(
      async (callback: (entityManager: EntityManager) => Promise<unknown>) => {
        try {
          return await callback(manager as unknown as EntityManager);
        } catch (error) {
          transactionRejected = true;
          throw error;
        }
      },
    );
    const dataSource = { transaction } as unknown as DataSource;

    await expect(
      new SchoolsService(dataSource).rectifyAsAdmin(
        school.id,
        {
          ...completeDto(),
          schoolNumber: '1-001',
          expectedUpdatedAt: school.updatedAt.toISOString(),
        },
        { id: 'actor-id' } as never,
      ),
    ).rejects.toBe(persistenceError);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transactionRejected).toBe(true);
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it('rechaza una invocación interna que omite datos mínimos', async () => {
    const school = { id: 'school-id' } as School;
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(school),
      })),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager as unknown as EntityManager),
      ),
    } as unknown as DataSource;

    await expect(
      new SchoolsService(dataSource).rectify(
        school.id,
        { ...completeDto(), hasKiosk: undefined } as never,
        { id: 'actor-id' } as never,
      ),
    ).rejects.toThrow('kiosco');
  });
});

describe('SchoolsService evaluation rectification gate', () => {
  const completeSnapshot = {
    name: 'Escuela Uno',
    cue: '500012300',
    directorName: 'Ana Pérez',
    department: 'Capital',
    address: 'Calle 1',
    locality: 'Mendoza',
    scope: 'Urbano',
    educationLevel: 'Educación común',
    shift: 'Simple',
    hasKiosk: false,
    hasFoodService: true,
    shiftCatalog: { id: 'shift-id', code: 'simple', label: 'Simple' },
    educationLevels: [
      { id: 'level-id', code: 'primario', label: 'Primario', enrollment: 10 },
    ],
  } as SchoolRectification['snapshot'];

  it('usa solamente la última rectificación y bloquea si su snapshot está incompleto', async () => {
    let rectificationOptions: Record<string, unknown> | undefined;
    let callCount = 0;
    const findOne = jest.fn(
      (_entity: EntityTarget<unknown>, options?: Record<string, unknown>) => {
        callCount += 1;
        if (callCount === 1)
          return Promise.resolve({
            schoolId: 'school-id',
            school: { id: 'school-id', isActive: true },
          });
        rectificationOptions = options;
        return Promise.resolve({
          id: 'latest-id',
          rectifiedAt: new Date(),
          snapshot: { ...completeSnapshot, hasFoodService: null },
        });
      },
    );
    const manager = {
      findOne,
    } as unknown as EntityManager;

    const context = await new SchoolsService(
      {} as DataSource,
    ).evaluationContextForUser('user-id', manager);

    expect(context.rectification).toMatchObject({
      id: 'latest-id',
      isConfirmed: true,
      isEvaluationReady: false,
      isRectified: false,
      missingFields: [
        {
          code: 'hasFoodService',
          label: 'Comedor o servicio alimentario',
        },
      ],
    });
    expect(rectificationOptions).toMatchObject({
      order: { rectifiedAt: 'DESC' },
    });
  });

  it('habilita la evaluación cuando la última rectificación está completa', async () => {
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          schoolId: 'school-id',
          school: { id: 'school-id', isActive: true },
        })
        .mockResolvedValueOnce({
          id: 'latest-id',
          rectifiedAt: new Date(),
          snapshot: completeSnapshot,
        }),
    } as unknown as EntityManager;

    const context = await new SchoolsService(
      {} as DataSource,
    ).evaluationContextForUser('user-id', manager);

    expect(context.rectification).toMatchObject({
      isConfirmed: true,
      isEvaluationReady: true,
      isRectified: true,
      missingFields: [],
    });
  });

  it('distingue la ausencia de confirmación de una confirmación incompleta', async () => {
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          schoolId: 'school-id',
          school: { id: 'school-id', isActive: true },
        })
        .mockResolvedValueOnce(null),
    } as unknown as EntityManager;

    const context = await new SchoolsService(
      {} as DataSource,
    ).evaluationContextForUser('user-id', manager);

    expect(context.rectification).toMatchObject({
      id: null,
      isConfirmed: false,
      isEvaluationReady: false,
      isRectified: false,
      missingFields: [],
      rectifiedAt: null,
    });
  });
});
