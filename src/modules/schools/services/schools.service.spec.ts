import { DataSource, EntityManager, EntityTarget } from 'typeorm';
import { UserRole } from '../../users/entities/user-role.enum';
import { User } from '../../users/entities/user.entity';
import { School } from '../entities/school.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SchoolRectification } from '../entities/school-rectification.entity';
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
});
