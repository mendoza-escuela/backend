import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { UserRole } from '../../users/entities/user-role.enum';
import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { SurveyVersion } from '../entities/survey-version.entity';
import { Survey } from '../entities/survey.entity';
import { AdminSurveysService } from './admin-surveys.service';
import { SurveyStructureValidator } from './survey-structure-validator.service';
import { SurveyVersionComparator } from './survey-version-comparator.service';

describe('AdminSurveysService', () => {
  const manager = {
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  };
  const validator = new SurveyStructureValidator();
  let service: AdminSurveysService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminSurveysService(
      dataSource as unknown as DataSource,
      validator,
      new SurveyVersionComparator(),
    );
  });

  it('pagina cuestionarios y sus resúmenes de versión en base de datos', async () => {
    const builder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 'survey-id',
            code: 'diagnostico',
            name: 'Diagnóstico',
            description: null,
            isActive: true,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
            versions: [version()],
          },
        ],
        22,
      ]),
    };
    const listDataSource = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => builder),
      })),
    } as unknown as DataSource;
    const listService = new AdminSurveysService(
      listDataSource,
      validator,
      new SurveyVersionComparator(),
    );

    const response = await listService.list({
      search: 'diag',
      page: 2,
      limit: 20,
    });

    expect(builder.orderBy).toHaveBeenCalledWith('survey.name', 'ASC');
    expect(builder.skip).toHaveBeenCalledWith(20);
    expect(builder.take).toHaveBeenCalledWith(20);
    expect(response.pagination).toEqual({
      page: 2,
      limit: 20,
      total: 22,
      totalPages: 2,
    });
  });

  it('rechaza modificar una versión publicada antes de tocar su estructura', async () => {
    manager.findOne.mockResolvedValue(
      version({ status: SurveyVersionStatus.Published }),
    );

    await expect(
      service.updateVersion(
        'survey-id',
        'version-id',
        { title: 'Intento', instructions: null, dimensions: [] },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rechaza publicar un borrador incompleto sin persistir cambios', async () => {
    const draft = version();
    manager.findOne
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ ...draft, dimensions: [] });

    await expect(
      service.publishVersion('survey-id', 'version-id', actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(manager.save).not.toHaveBeenCalled();
  });

  it('expone todos los errores en la validación previa', async () => {
    const repository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'survey-id' }),
    };
    const draft = version({ dimensions: [] });
    (dataSource as { getRepository?: jest.Mock }).getRepository = jest
      .fn()
      .mockReturnValue(repository);
    (dataSource as { manager?: EntityManager }).manager =
      manager as unknown as EntityManager;
    manager.findOne.mockResolvedValue(draft);

    await expect(
      service.validateVersion('survey-id', 'version-id'),
    ).resolves.toEqual({
      valid: false,
      errors: ['La versión debe contener al menos una dimensión.'],
      counts: { dimensions: 0, sections: 0, questions: 0, options: 0 },
    });
  });
});

const actor: AuthenticatedUser = {
  id: 'actor-id',
  firstName: 'Admin',
  lastName: 'Test',
  email: 'admin@example.com',
  role: UserRole.Admin,
  sessionId: 'session-id',
  mustChangePassword: false,
  lastLoginAt: null,
};

function version(overrides: Partial<SurveyVersion> = {}): SurveyVersion {
  return {
    id: 'version-id',
    surveyId: 'survey-id',
    survey: {} as Survey,
    versionNumber: 1,
    title: 'Versión',
    instructions: null,
    status: SurveyVersionStatus.Draft,
    publishedAt: null,
    dimensions: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}
