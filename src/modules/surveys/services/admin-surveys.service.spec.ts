import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SurveyApplicabilityRule } from '../entities/survey-applicability-rule.entity';
import { SurveyApplicabilityCondition } from '../entities/survey-applicability-condition.entity';
import {
  OFFICIAL_SURVEY_DIMENSIONS,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';

describe('AdminSurveysService', () => {
  const manager = {
    create: jest.fn(
      (_entity: unknown, attributes: Record<string, unknown>) => attributes,
    ),
    findOne: jest.fn(),
    find: jest.fn(),
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
      .mockResolvedValueOnce({ id: 'survey-id' })
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ ...draft, dimensions: [] });

    await expect(
      service.publishVersion('survey-id', 'version-id', actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(manager.save).not.toHaveBeenCalled();
  });

  it('publica el primer borrador y audita la transición sin archivar', async () => {
    const draft = publishableVersion();
    manager.findOne
      .mockResolvedValueOnce({ id: draft.surveyId })
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    manager.find.mockResolvedValue([]);
    manager.save.mockImplementation(
      (_entity: unknown, value: Record<string, unknown>) => value,
    );
    jest
      .spyOn(service, 'findVersion')
      .mockResolvedValue({ id: draft.id } as never);

    await service.publishVersion(draft.surveyId, draft.id, actor);

    expect(draft.status).toBe(SurveyVersionStatus.Published);
    expect(draft.publishedAt).toBeInstanceOf(Date);
    expect(manager.findOne).toHaveBeenNthCalledWith(
      1,
      Survey,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(manager.find).toHaveBeenCalledWith(
      SurveyVersion,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    const audits = manager.save.mock.calls.filter(
      ([entity]) => entity === AuditLog,
    );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).toContain('SURVEY_VERSION_PUBLISHED');
    expect(JSON.stringify(audits)).toContain(
      '"previousPublishedVersionId":null',
    );
  });

  it('archiva la vigente y publica la nueva dentro de la misma transacción', async () => {
    const draft = publishableVersion({
      id: 'new-version-id',
      versionNumber: 2,
    });
    const previous = version({
      id: 'previous-version-id',
      status: SurveyVersionStatus.Published,
      publishedAt: new Date('2026-01-01'),
    });
    manager.findOne
      .mockResolvedValueOnce({ id: draft.surveyId })
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    manager.find.mockResolvedValue([previous]);
    manager.save.mockImplementation(
      (_entity: unknown, value: Record<string, unknown>) => value,
    );
    jest
      .spyOn(service, 'findVersion')
      .mockResolvedValue({ id: draft.id } as never);

    await service.publishVersion(draft.surveyId, draft.id, actor);

    expect(previous.status).toBe(SurveyVersionStatus.Archived);
    expect(draft.status).toBe(SurveyVersionStatus.Published);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const serializedAudits = manager.save.mock.calls
      .filter(([entity]) => entity === AuditLog)
      .map(([, entry]) => JSON.stringify(entry));
    expect(serializedAudits).toHaveLength(2);
    expect(serializedAudits[0]).toContain('SURVEY_VERSION_AUTO_ARCHIVED');
    expect(serializedAudits[1]).toContain('SURVEY_VERSION_PUBLISHED');
    const operationIds = serializedAudits.map(
      (entry) => entry.match(/"publicationOperationId":"([^"]+)"/)?.[1],
    );
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(serializedAudits.join()).toContain('previous-version-id');
    expect(JSON.stringify(manager.save.mock.calls)).not.toContain('Campaign');
  });

  it('aborta si ya existen varias versiones publicadas', async () => {
    const draft = publishableVersion();
    manager.findOne
      .mockResolvedValueOnce({ id: draft.surveyId })
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    manager.find.mockResolvedValue([
      version({ id: 'published-1', status: SurveyVersionStatus.Published }),
      version({ id: 'published-2', status: SurveyVersionStatus.Published }),
    ]);

    await expect(
      service.publishVersion(draft.surveyId, draft.id, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it.each([SurveyVersionStatus.Published, SurveyVersionStatus.Archived])(
    'rechaza publicar una versión %s',
    async (status) => {
      manager.findOne
        .mockResolvedValueOnce({ id: 'survey-id' })
        .mockResolvedValueOnce(version({ status }));
      await expect(
        service.publishVersion('survey-id', 'version-id', actor),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.find).not.toHaveBeenCalled();
    },
  );

  it('distingue cuestionario y versión inexistentes o ajenos', async () => {
    manager.findOne.mockResolvedValueOnce(null);
    await expect(
      service.publishVersion('missing-survey', 'version-id', actor),
    ).rejects.toBeInstanceOf(NotFoundException);

    jest.clearAllMocks();
    manager.findOne
      .mockResolvedValueOnce({ id: 'survey-id' })
      .mockResolvedValueOnce(null);
    await expect(
      service.publishVersion('survey-id', 'foreign-version', actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('convierte la colisión del índice parcial en un conflicto controlado', async () => {
    const draft = publishableVersion();
    manager.findOne
      .mockResolvedValueOnce({ id: draft.surveyId })
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    manager.find.mockResolvedValue([]);
    manager.save.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_survey_versions_single_published',
    });

    await expect(
      service.publishVersion(draft.surveyId, draft.id, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('propaga un fallo de auditoría para que la transacción haga rollback', async () => {
    const draft = publishableVersion();
    const previous = version({
      id: 'previous-version-id',
      status: SurveyVersionStatus.Published,
    });
    manager.findOne
      .mockResolvedValueOnce({ id: draft.surveyId })
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);
    manager.find.mockResolvedValue([previous]);
    manager.save.mockImplementation(
      (entity: unknown, value: Record<string, unknown>) => {
        if (entity === AuditLog) throw new Error('audit unavailable');
        return value;
      },
    );

    await expect(
      service.publishVersion(draft.surveyId, draft.id, actor),
    ).rejects.toThrow('audit unavailable');
    expect(draft.status).toBe(SurveyVersionStatus.Draft);
    expect(manager.save).not.toHaveBeenCalledWith(
      SurveyVersion,
      expect.objectContaining({ id: draft.id }),
    );
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

  it('no impone dimensiones, obligatoriedad ni secuencias de puntaje por código', async () => {
    const repository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'survey-id' }),
    };
    const draft = officialPublishableDraft();
    draft.dimensions[0].sections[0].questions[0].required = false;
    draft.dimensions[0].sections[0].questions[0].options.forEach(
      (option, index) => {
        option.score = [0, 50, 100][index];
      },
    );
    draft.dimensions = draft.dimensions.filter(
      ({ code }) => code !== String(OfficialSurveyDimensionCode.MentalHealth),
    );
    (dataSource as { getRepository?: jest.Mock }).getRepository = jest
      .fn()
      .mockReturnValue(repository);
    (dataSource as { manager?: EntityManager }).manager =
      manager as unknown as EntityManager;
    manager.findOne.mockResolvedValue(draft);

    const response = await service.validateVersion(draft.surveyId, draft.id);

    expect(response.valid).toBe(true);
    expect(response.errors).toEqual([]);
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

  it('no inventa reglas de aplicabilidad al importar una pregunta', async () => {
    manager.findOne
      .mockResolvedValueOnce({ id: 'survey-id' })
      .mockResolvedValueOnce(null);
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
      { title: 'Importación oficial' },
      [
        {
          code: 'entorno_alimentario',
          title: 'Entorno Alimentario Seguro y Saludable',
          sections: [
            {
              code: 'kiosco',
              title: 'Kiosco',
              questions: [
                {
                  code: 'p021',
                  type: SurveyQuestionType.SingleChoice,
                  prompt: '¿Pregunta sobre kiosco?',
                  required: true,
                  options: [],
                },
              ],
            },
          ],
        },
      ],
      actor,
    );

    expect(manager.save).not.toHaveBeenCalledWith(
      SurveyApplicabilityRule,
      expect.anything(),
    );
    expect(manager.save).not.toHaveBeenCalledWith(
      SurveyApplicabilityCondition,
      expect.anything(),
    );
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

function publishableVersion(
  overrides: Partial<SurveyVersion> = {},
): SurveyVersion {
  return version({
    dimensions: [
      {
        id: 'dimension-id',
        code: 'dimension_prueba',
        title: 'Dimensión de prueba',
        description: null,
        order: 0,
        sections: [
          {
            id: 'section-id',
            code: 'seccion_prueba',
            title: 'Sección de prueba',
            description: null,
            order: 0,
            questions: [
              {
                id: 'question-id',
                code: 'pregunta_prueba',
                type: SurveyQuestionType.SingleChoice,
                prompt: '¿Pregunta de prueba?',
                helpText: null,
                required: true,
                order: 0,
                validation: {},
                applicabilityRules: [],
                options: [
                  {
                    id: 'option-id',
                    value: 'si',
                    label: 'Sí',
                    helpText: null,
                    score: 100,
                    order: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
    ] as SurveyVersion['dimensions'],
    ...overrides,
  });
}

function officialPublishableDraft(): SurveyVersion {
  const dimensions = OFFICIAL_SURVEY_DIMENSIONS.map((definition) => ({
    id: `dimension-${definition.order}`,
    versionId: 'version-id',
    code: definition.code,
    title: definition.title,
    description: definition.description,
    order: definition.order,
    sections: [
      {
        id: `section-${definition.order}`,
        dimensionId: `dimension-${definition.order}`,
        code: `section_${definition.order}`,
        title: definition.title,
        description: null,
        order: 0,
        questions: [],
      },
    ],
  })) as SurveyDimension[];

  for (let number = 1; number <= 60; number += 1) {
    const dimension = dimensions.find(
      ({ code }) => code === String(officialDimensionFor(number)),
    )!;
    const code = `p${String(number).padStart(3, '0')}`;
    const labels =
      number === 32
        ? [
            'Se incluyen diariamente.',
            'Se incluyen de 2 a 3 veces por semana.',
            'Se incluyen una vez por semana.',
          ]
        : [
            'Respuesta óptima',
            'Respuesta intermedia',
            number === 46 ? 'No se abordan estos temas.' : 'Respuesta inicial',
          ];
    dimension.sections[0].questions.push({
      id: `question-${number}`,
      sectionId: dimension.sections[0].id,
      code,
      type: SurveyQuestionType.SingleChoice,
      prompt:
        number === 10
          ? 'Tiempo adecuado para las comidas escolares: Garantía de un tiempo adecuado, asegurando al menos 10 minutos para desayunos y meriendas, y 30 minutos para almuerzos.'
          : number === 32
            ? 'Inclusión diaria de frutas y/o verduras frescas, crudas y preferentemente de estación.'
            : `Pregunta ${number}`,
      helpText: null,
      required: true,
      order: number,
      validation: {},
      applicabilityRules: [],
      options: labels.map((label, index) => ({
        id: `option-${number}-${index}`,
        questionId: `question-${number}`,
        value: `opcion_${index + 1}`,
        label:
          number === 10 && index === 0
            ? 'Se garantiza sistemáticamente 10 minutos para desayuno/merienda y 30 minutos para almuerzo.'
            : label,
        helpText: null,
        score:
          dimension.code === String(OfficialSurveyDimensionCode.MentalHealth)
            ? [100, 66, 0][index]
            : [100, 50, 0][index],
        order: index,
      })),
    });
  }

  return version({ dimensions });
}

function officialDimensionFor(number: number): OfficialSurveyDimensionCode {
  if (number <= 5) return OfficialSurveyDimensionCode.InstitutionalCommitment;
  if (number <= 7) return OfficialSurveyDimensionCode.HealthTeamCoordination;
  if (number <= 34) return OfficialSurveyDimensionCode.HealthyFoodEnvironment;
  if (number <= 40) return OfficialSurveyDimensionCode.PhysicalActivity;
  if (number <= 43) return OfficialSurveyDimensionCode.MentalHealth;
  if (number <= 46) return OfficialSurveyDimensionCode.SmokeFreeSpaces;
  return OfficialSurveyDimensionCode.MentalHealth;
}
