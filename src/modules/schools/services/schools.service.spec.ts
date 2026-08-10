import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, EntityTarget } from 'typeorm';
import { UserRole } from '../../users/entities/user-role.enum';
import { User } from '../../users/entities/user.entity';
import { School } from '../entities/school.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SchoolRectification } from '../entities/school-rectification.entity';
import { EducationLevelCatalog } from '../entities/education-level-catalog.entity';
import { SchoolEducationLevel } from '../entities/school-education-level.entity';
import { SchoolRectificationEducationLevel } from '../entities/school-rectification-education-level.entity';
import { SchoolShiftCatalog } from '../entities/school-shift-catalog.entity';
import { SchoolsService } from './schools.service';

describe('SchoolsService pagination', () => {
  it('pagina el padrón en base de datos y devuelve sólo campos del listado', async () => {
    const builder = {
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 45]),
    };
    const dataSource = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => builder),
      })),
    } as unknown as DataSource;

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
      },
    ] as User[];
    const builder = {
      leftJoin: jest.fn().mockReturnThis(),
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
    expect(builder.orderBy).toHaveBeenCalledWith('user.lastName', 'ASC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('user.firstName', 'ASC');
    expect(builder.skip).toHaveBeenCalledWith(20);
    expect(builder.take).toHaveBeenCalledWith(20);
    expect(response.pagination.totalPages).toBe(2);
  });
});

describe('SchoolsService annual rectification', () => {
  it('updates mandatory data and stores a snapshot with actor and period', async () => {
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Directora Anterior',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Primario',
      shift: 'Simple',
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
      {
        cue: '500012300',
        name: 'Escuela Uno',
        directorName: 'María González',
        address: 'Calle 2',
        locality: 'Mendoza',
        scope: 'Urbano',
        educationLevel: 'Primario',
        shift: 'Completa',
      },
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

  it('guarda datos estructurados y un snapshot autocontenido e inmutable', async () => {
    const updatedAt = new Date('2026-07-29T12:00:00.000Z');
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Ana Pérez',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Dato heredado',
      shift: 'Dato heredado',
      shiftCatalogId: null,
      enrollment: null,
      hasKiosk: null,
      hasFoodService: null,
      isBoarding: null,
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
        return Promise.resolve(value);
      }),
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
      .mockResolvedValue({ id: school.id } as never);

    await service.rectify(
      school.id,
      {
        name: school.name,
        cue: school.cue,
        directorName: school.directorName,
        address: school.address,
        locality: school.locality,
        scope: school.scope,
        hasKiosk: false,
        hasFoodService: true,
        isBoarding: null,
        shiftCatalogId: shift.id,
        enrollment: 0,
        educationLevels: [
          { levelId: levels[0].id, enrollment: 0 },
          { levelId: levels[1].id, enrollment: null },
        ],
        expectedUpdatedAt: updatedAt.toISOString(),
      },
      { id: 'actor-id' } as never,
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
      schemaVersion: 3,
      hasKiosk: false,
      hasFoodService: true,
      isBoarding: null,
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

    shift.label = 'Nombre nuevo';
    levels[0].label = 'Etiqueta nueva';
    school.hasKiosk = true;
    expect(savedSnapshot?.shiftCatalog?.label).toBe('Jornada completa');
    expect(savedSnapshot?.educationLevels?.[0].label).toBe('Primario');
    expect(savedSnapshot?.hasKiosk).toBe(false);
  });

  it('rechaza niveles duplicados y conflictos de concurrencia', async () => {
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Ana Pérez',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Dato heredado',
      shift: 'Dato heredado',
      shiftCatalogId: null,
      updatedAt: new Date('2026-07-29T12:00:00.000Z'),
    } as School;
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(school),
      })),
      find: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager as unknown as EntityManager),
      ),
    } as unknown as DataSource;
    const service = new SchoolsService(dataSource);
    const baseDto = {
      name: school.name,
      cue: school.cue,
      directorName: school.directorName,
      address: school.address,
      locality: school.locality,
      scope: school.scope,
    };

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

    await expect(
      service.rectify(
        school.id,
        {
          ...baseDto,
          expectedUpdatedAt: '2026-07-29T13:00:00.000Z',
        },
        { id: 'actor-id' } as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza jornadas y niveles inexistentes o inactivos', async () => {
    const school = {
      id: 'school-id',
      cue: '500012300',
      name: 'Escuela Uno',
      directorName: 'Ana Pérez',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Dato heredado',
      shift: 'Dato heredado',
      shiftCatalogId: null,
      updatedAt: new Date(),
    } as School;
    const manager = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(school),
      })),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
      findBy: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager as unknown as EntityManager),
      ),
    } as unknown as DataSource;
    const service = new SchoolsService(dataSource);
    const baseDto = {
      name: school.name,
      cue: school.cue,
      directorName: school.directorName,
      address: school.address,
      locality: school.locality,
      scope: school.scope,
    };
    const shiftId = '8bbdded8-8980-4a27-a1dc-95d39362f510';
    const levelId = 'c6a0ca01-6db2-44a0-a841-9426c33ee88c';

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
});
