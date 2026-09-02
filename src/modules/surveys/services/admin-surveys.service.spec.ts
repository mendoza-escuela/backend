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
import { SurveyQuestion } from '../entities/survey-question.entity';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import { SurveySection } from '../entities/survey-section.entity';
import { UpdateSurveyVersionDto } from '../dto/update-survey-version.dto';
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
import { InstitutionalSurveyEvaluabilityPolicy } from '../policies/institutional-survey-evaluability.policy';
import { getApprovedOfficialQuestionScoreSequence } from '../policies/official-survey-scoring.policy';
import { SurveyVersionCertificationService } from './survey-version-certification.service';

describe('AdminSurveysService', () => {
  const manager = {
    create: jest.fn(
      (_entity: unknown, attributes: Record<string, unknown>) => attributes,
    ),
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
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
    const rulesService = {
      validateRules: jest.fn(() => []),
    } as unknown as ApplicabilityRulesService;
    service = new AdminSurveysService(
      dataSource as unknown as DataSource,
      validator,
      new SurveyVersionComparator(),
      new SurveyVersionCertificationService(
        validator,
        rulesService,
        new InstitutionalSurveyEvaluabilityPolicy(),
      ),
    );
  });

  function prepareStructureUpdate(current: SurveyVersion) {
    manager.findOne.mockReset();
    manager.findOne
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current);
    manager.save.mockReset();
    manager.save.mockImplementation(
      (entity: unknown, attributes: Record<string, unknown>) => {
        if (attributes.id) return attributes;
        const generatedId =
          entity === SurveyDimension
            ? 'new-dimension-id'
            : entity === SurveySection
              ? 'new-section-id'
              : entity === SurveyQuestion
                ? 'new-question-id'
                : entity === SurveyOption
                  ? 'new-option-id'
                  : 'audit-id';
        return { ...attributes, id: generatedId };
      },
    );
    manager.update.mockResolvedValue({ affected: 1 });
    manager.delete.mockResolvedValue({ affected: 1 });
    jest.spyOn(service, 'findVersion').mockResolvedValue({
      id: current.id,
      updatedAt: new Date('2026-01-01T00:00:00.001Z'),
    } as never);
  }

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
    const rulesService = {
      validateRules: jest.fn(() => []),
    } as unknown as ApplicabilityRulesService;
    const listService = new AdminSurveysService(
      listDataSource,
      validator,
      new SurveyVersionComparator(),
      new SurveyVersionCertificationService(
        validator,
        rulesService,
        new InstitutionalSurveyEvaluabilityPolicy(),
      ),
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
        {
          expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
          title: 'Intento',
          instructions: null,
          dimensions: [],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rechaza una revisión desactualizada dentro del lock sin tocar contenido', async () => {
    const current = editableVersionWithRule();
    manager.findOne.mockResolvedValue(current);

    let conflict: unknown;
    try {
      await service.updateVersion(
        current.surveyId,
        current.id,
        {
          ...writeInput(current),
          expectedUpdatedAt: '2025-12-31T23:59:59.000Z',
        },
        actor,
      );
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getResponse()).toMatchObject({
      code: 'SURVEY_VERSION_EDIT_CONFLICT',
    });

    expect(manager.findOne).toHaveBeenCalledWith(
      SurveyVersion,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('renombra una pregunta conservando su UUID y sus reglas', async () => {
    const current = editableVersionWithRule();
    const input = writeInput(current);
    input.dimensions[0].sections[0].questions[0].code = 'pregunta_renombrada';
    prepareStructureUpdate(current);

    await service.updateVersion(current.surveyId, current.id, input, actor);

    expect(manager.save).toHaveBeenCalledWith(
      SurveyQuestion,
      expect.objectContaining({
        id: 'question-id',
        code: 'pregunta_renombrada',
      }),
    );
    expect(manager.save).not.toHaveBeenCalledWith(
      SurveyApplicabilityRule,
      expect.anything(),
    );
    expect(manager.delete).not.toHaveBeenCalledWith(
      SurveyQuestion,
      expect.anything(),
    );
    expect(manager.update).toHaveBeenCalledWith(
      SurveyVersion,
      current.id,
      expect.anything(),
    );
    const revisionCall = (
      manager.update.mock.calls as unknown as Array<[unknown, unknown, unknown]>
    ).find(([entity, id]) => entity === SurveyVersion && id === current.id);
    const revisionExpression = revisionCall?.[2] as
      { updatedAt?: unknown } | undefined;
    expect(typeof revisionExpression?.updatedAt).toBe('function');
    if (typeof revisionExpression?.updatedAt === 'function')
      expect((revisionExpression.updatedAt as () => string)()).toContain(
        'GREATEST',
      );
  });

  it('mueve una pregunta entre secciones sin desvincular sus reglas', async () => {
    const current = editableVersionWithRule();
    const firstDimension = current.dimensions[0];
    firstDimension.sections.push({
      id: 'section-target-id',
      dimensionId: firstDimension.id,
      code: 'destino',
      title: 'Destino',
      description: null,
      order: 1,
      questions: [],
    } as SurveySection);
    const input = writeInput(current);
    const [movedQuestion] = input.dimensions[0].sections[0].questions.splice(
      0,
      1,
    );
    input.dimensions[0].sections[1].questions.push(movedQuestion);
    prepareStructureUpdate(current);

    await service.updateVersion(current.surveyId, current.id, input, actor);

    expect(manager.save).toHaveBeenCalledWith(
      SurveyQuestion,
      expect.objectContaining({
        id: 'question-id',
        sectionId: 'section-target-id',
      }),
    );
    expect(manager.save).not.toHaveBeenCalledWith(
      SurveyApplicabilityRule,
      expect.anything(),
    );
    expect(manager.delete).not.toHaveBeenCalledWith(
      SurveyQuestion,
      expect.anything(),
    );
  });

  it('al eliminar y reutilizar un código crea otra pregunta y no transfiere reglas', async () => {
    const current = editableVersionWithRule();
    const input = writeInput(current);
    input.dimensions[0].sections[0].questions = [
      {
        id: null,
        code: 'pregunta_prueba',
        type: SurveyQuestionType.SingleChoice,
        prompt: 'Pregunta nueva con código reutilizado',
        required: true,
        validation: {},
        options: [
          {
            id: null,
            value: 'si',
            label: 'Sí',
            score: 100,
          },
        ],
      },
    ];
    prepareStructureUpdate(current);

    await service.updateVersion(current.surveyId, current.id, input, actor);

    const newQuestionCall = (
      manager.save.mock.calls as unknown as Array<[unknown, unknown]>
    ).find(([entity]) => entity === SurveyQuestion);
    const newQuestion = newQuestionCall?.[1] as Record<string, unknown>;
    expect(newQuestion).toEqual(
      expect.objectContaining({
        code: 'pregunta_prueba',
        prompt: 'Pregunta nueva con código reutilizado',
      }),
    );
    expect(newQuestion).not.toHaveProperty('id');
    expect(manager.save).toHaveBeenCalledWith(
      SurveyOption,
      expect.objectContaining({ questionId: 'new-question-id' }),
    );
    expect(manager.delete).toHaveBeenCalledWith(SurveyQuestion, [
      'question-id',
    ]);
    expect(manager.save).not.toHaveBeenCalledWith(
      SurveyApplicabilityRule,
      expect.anything(),
    );
  });

  it('rechaza identidades ajenas o repetidas antes de reconciliar', async () => {
    const current = editableVersionWithRule();
    const foreign = writeInput(current);
    foreign.dimensions[0].sections[0].questions[0].id = 'foreign-question-id';
    manager.findOne
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current);

    let identityConflict: unknown;
    try {
      await service.updateVersion(current.surveyId, current.id, foreign, actor);
    } catch (error) {
      identityConflict = error;
    }
    expect(identityConflict).toBeInstanceOf(ConflictException);
    expect((identityConflict as ConflictException).getResponse()).toMatchObject(
      {
        code: 'SURVEY_STRUCTURE_IDENTITY_CONFLICT',
      },
    );

    jest.clearAllMocks();
    const duplicated = writeInput(current);
    duplicated.dimensions[0].sections[0].questions.push({
      ...duplicated.dimensions[0].sections[0].questions[0],
      code: 'otra_pregunta',
    });
    manager.findOne
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current);

    await expect(
      service.updateVersion(current.surveyId, current.id, duplicated, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();

    jest.clearAllMocks();
    const legacyPayload = writeInput(current);
    delete legacyPayload.dimensions[0].sections[0].questions[0].id;
    manager.findOne
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current);

    await expect(
      service.updateVersion(current.surveyId, current.id, legacyPayload, actor),
    ).rejects.toThrow('La identidad de cada pregunta debe enviarse');
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
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
      profile: 'generic',
      evaluable: false,
      evaluationErrors: [
        'La versión debe contener al menos una dimensión.',
        'La versión es genérica y no puede utilizarse en campañas institucionales evaluables.',
      ],
    });
  });

  it('expone las reglas institucionales en validación sin ocultar errores', async () => {
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

    expect(response.profile).toBe('institutional');
    expect(response.valid).toBe(false);
    expect(response.evaluable).toBe(false);
    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('seis dimensiones oficiales'),
        expect.stringContaining('obligatorias'),
        expect.stringContaining('p001'),
      ]),
    );
    expect(response.evaluationErrors).toEqual(response.errors);
  });

  it('rechaza publicar una versión institucional con puntajes distintos de los aprobados', async () => {
    const draft = officialPublishableDraft();
    const p038 = draft.dimensions
      .flatMap((dimension) => dimension.sections)
      .flatMap((section) => section.questions)
      .find(({ code }) => code === 'p038')!;
    p038.options.forEach((option, index) => {
      option.score = [100, 50, 0, 0][index];
    });
    manager.findOne
      .mockResolvedValueOnce({ id: draft.surveyId })
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft);

    await expect(
      service.publishVersion(draft.surveyId, draft.id, actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(manager.find).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('publica una versión institucional con los puntajes aprobados del Excel', async () => {
    const draft = officialPublishableDraft();
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
    expect(manager.find).toHaveBeenCalledWith(
      SurveyVersion,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
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

function editableVersionWithRule(): SurveyVersion {
  const editable = publishableVersion();
  const dimension = editable.dimensions[0];
  dimension.versionId = editable.id;
  const section = dimension.sections[0];
  section.dimensionId = dimension.id;
  const question = section.questions[0];
  question.sectionId = section.id;
  question.options[0].questionId = question.id;
  question.applicabilityRules = [
    {
      id: 'rule-id',
      questionId: question.id,
      groupOperator: 'all',
      action: 'omit',
      defaultAction: 'show',
      order: 0,
      conditions: [
        {
          id: 'condition-id',
          ruleId: 'rule-id',
          feature: 'has_kiosk',
          operator: 'equals',
          expectedValue: true,
          order: 0,
        },
      ],
    },
  ] as SurveyQuestion['applicabilityRules'];
  return editable;
}

function writeInput(version: SurveyVersion): UpdateSurveyVersionDto {
  return {
    expectedUpdatedAt: version.updatedAt.toISOString(),
    title: version.title,
    instructions: version.instructions,
    dimensions: version.dimensions.map((dimension) => ({
      id: dimension.id,
      code: dimension.code,
      title: dimension.title,
      description: dimension.description,
      sections: dimension.sections.map((section) => ({
        id: section.id,
        code: section.code,
        title: section.title,
        description: section.description,
        questions: section.questions.map((question) => ({
          id: question.id,
          code: question.code,
          type: question.type,
          prompt: question.prompt,
          helpText: question.helpText,
          required: question.required,
          validation: question.validation,
          options: question.options.map((option) => ({
            id: option.id,
            value: option.value,
            label: option.label,
            helpText: option.helpText,
            score: option.score,
          })),
        })),
      })),
    })),
  };
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
    const scores = getApprovedOfficialQuestionScoreSequence(code);
    if (!scores)
      throw new Error(`No existe una secuencia oficial para ${code}.`);
    const labels =
      number === 32
        ? [
            'Se incluyen diariamente.',
            'Se incluyen de 2 a 3 veces por semana.',
            'Se incluyen una vez por semana.',
          ]
        : scores.map((_, index) =>
            number === 46 && index === scores.length - 1
              ? 'No se abordan estos temas.'
              : `Respuesta ${index + 1}`,
          );
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
        score: scores[index],
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
