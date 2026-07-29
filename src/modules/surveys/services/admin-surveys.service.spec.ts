import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { UserRole } from '../../users/entities/user-role.enum';
import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { SurveyVersionTemplate } from '../entities/survey-version-template.enum';
import { SurveyVersion } from '../entities/survey-version.entity';
import { Survey } from '../entities/survey.entity';
import { SurveyDimension } from '../entities/survey-dimension.entity';
import { SurveyOption } from '../entities/survey-option.entity';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import { AdminSurveysService } from './admin-surveys.service';
import { SurveyStructureValidator } from './survey-structure-validator.service';
import { SurveyVersionComparator } from './survey-version-comparator.service';
import { ApplicabilityRulesService } from './applicability-rules.service';

describe('AdminSurveysService', () => {
  const manager = {
    create: jest.fn(
      (_entity: unknown, attributes: Record<string, unknown>) => attributes,
    ),
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
      {
        validateRules: jest.fn(() => []),
      } as unknown as ApplicabilityRulesService,
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
      {
        validateRules: jest.fn(() => []),
      } as unknown as ApplicabilityRulesService,
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

  it('crea un borrador nuevo con las seis dimensiones oficiales por defecto', async () => {
    manager.findOne
      .mockResolvedValueOnce({ id: 'survey-id' })
      .mockResolvedValueOnce(null);
    manager.save.mockImplementation(
      (entity: unknown, attributes: Record<string, unknown>) => ({
        ...attributes,
        id: entity === SurveyVersion ? 'new-version-id' : 'saved-id',
      }),
    );
    const findVersion = jest
      .spyOn(service, 'findVersion')
      .mockResolvedValue({ id: 'new-version-id' } as never);

    await service.createVersion(
      'survey-id',
      { title: 'Diagnóstico anual' },
      actor,
    );

    for (const [order, code] of [
      'compromiso_institucional',
      'articulacion_equipos_salud',
      'entorno_alimentario',
      'actividad_fisica',
      'espacios_libres_humo',
      'salud_mental',
    ].entries())
      expect(manager.save).toHaveBeenCalledWith(
        SurveyDimension,
        expect.objectContaining({ code, order }),
      );
    expect(findVersion).toHaveBeenCalledWith('survey-id', 'new-version-id');
  });

  it('permite solicitar explícitamente un borrador sin dimensiones', async () => {
    manager.findOne
      .mockResolvedValueOnce({ id: 'survey-id' })
      .mockResolvedValueOnce(null);
    manager.save.mockImplementation(
      (entity: unknown, attributes: Record<string, unknown>) => ({
        ...attributes,
        id: entity === SurveyVersion ? 'blank-version-id' : 'audit-id',
      }),
    );
    jest
      .spyOn(service, 'findVersion')
      .mockResolvedValue({ id: 'blank-version-id' } as never);

    await service.createVersion(
      'survey-id',
      {
        title: 'Borrador libre',
        template: SurveyVersionTemplate.Blank,
      },
      actor,
    );

    expect(
      manager.save.mock.calls.some(([entity]) => entity === SurveyDimension),
    ).toBe(false);
  });

  it('conserva los puntajes al clonar una versión', async () => {
    manager.findOne
      .mockResolvedValueOnce({ id: 'survey-id' })
      .mockResolvedValueOnce(version({ versionNumber: 1 }))
      .mockResolvedValueOnce(
        version({
          id: 'source-version-id',
          dimensions: [
            {
              id: 'dimension-id',
              versionId: 'source-version-id',
              code: 'salud_mental',
              title: 'Salud Mental',
              description: null,
              order: 0,
              sections: [
                {
                  id: 'section-id',
                  dimensionId: 'dimension-id',
                  code: 'general',
                  title: 'General',
                  description: null,
                  order: 0,
                  questions: [
                    {
                      id: 'question-id',
                      sectionId: 'section-id',
                      code: 'p041',
                      type: SurveyQuestionType.SingleChoice,
                      prompt: '¿Pregunta?',
                      helpText: null,
                      required: true,
                      order: 0,
                      validation: {},
                      options: [
                        {
                          id: 'option-id',
                          questionId: 'question-id',
                          value: 'en_proceso',
                          label: 'En proceso',
                          helpText: null,
                          score: 66,
                          order: 0,
                        },
                      ],
                    },
                  ],
                },
              ],
            } as SurveyDimension,
          ],
        }),
      );
    manager.save.mockImplementation(
      (entity: unknown, attributes: Record<string, unknown>) => ({
        ...attributes,
        id: entity === SurveyVersion ? 'cloned-version-id' : 'saved-id',
      }),
    );
    jest
      .spyOn(service, 'findVersion')
      .mockResolvedValue({ id: 'cloned-version-id' } as never);

    await service.createVersion(
      'survey-id',
      {
        title: 'Clon con puntajes',
        sourceVersionId: 'source-version-id',
      },
      actor,
    );

    expect(manager.save).toHaveBeenCalledWith(
      SurveyOption,
      expect.objectContaining({ value: 'en_proceso', score: 66 }),
    );
  });

  it('la importación crea una versión nueva en borrador sin reemplazar versiones', async () => {
    manager.findOne
      .mockResolvedValueOnce({ id: 'survey-id' })
      .mockResolvedValueOnce(version({ versionNumber: 3 }));
    manager.save.mockImplementation(
      (entity: unknown, attributes: Record<string, unknown>) => ({
        ...attributes,
        id: entity === SurveyVersion ? 'imported-version-id' : 'saved-id',
      }),
    );
    jest
      .spyOn(service, 'findVersion')
      .mockResolvedValue({ id: 'imported-version-id' } as never);

    await service.createImportedVersion(
      'survey-id',
      { title: 'Importación' },
      [
        {
          code: 'compromiso_institucional',
          title: 'Compromiso Institucional',
          sections: [],
        },
      ],
      actor,
    );

    expect(manager.save).toHaveBeenCalledWith(
      SurveyVersion,
      expect.objectContaining({
        versionNumber: 4,
        status: SurveyVersionStatus.Draft,
      }),
    );
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('rechaza combinar una plantilla con la clonación de una versión', async () => {
    await expect(
      service.createVersion(
        'survey-id',
        {
          title: 'Origen ambiguo',
          sourceVersionId: '00000000-0000-4000-8000-000000000001',
          template: SurveyVersionTemplate.OfficialDimensions,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('archiva una versión publicada y audita la transición', async () => {
    const published = version({ status: SurveyVersionStatus.Published });
    manager.findOne.mockResolvedValue(published);
    manager.save.mockImplementation(
      (_entity: unknown, value: Record<string, unknown>) =>
        Promise.resolve(value),
    );
    jest.spyOn(service, 'findVersion').mockResolvedValue({
      id: published.id,
    } as never);

    await service.archiveVersion('survey-id', published.id, actor);

    expect(published.status).toBe(SurveyVersionStatus.Archived);
    const serializedCalls = JSON.stringify(manager.save.mock.calls);
    expect(serializedCalls).toContain('SURVEY_VERSION_ARCHIVED');
    expect(serializedCalls).toContain('"previousStatus":"published"');
    expect(serializedCalls).toContain('"newStatus":"archived"');
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
