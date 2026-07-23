import { DataSource } from 'typeorm';
import { UserRole } from '../../users/entities/user-role.enum';
import { User } from '../../users/entities/user.entity';
import { School } from '../entities/school.entity';
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
