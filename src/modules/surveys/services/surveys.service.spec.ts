import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SurveyDimension } from '../entities/survey-dimension.entity';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { SurveyVersion } from '../entities/survey-version.entity';
import { Survey } from '../entities/survey.entity';
import { SurveysService } from './surveys.service';

describe('SurveysService', () => {
  const surveysRepository = {
    findOneBy: jest.fn(),
  };
  const listBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    distinctOn: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };
  const versionsRepository = {
    createQueryBuilder: jest.fn(() => listBuilder),
    findOne: jest.fn(),
  };
  let service: SurveysService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SurveysService(
      surveysRepository as unknown as Repository<Survey>,
      versionsRepository as unknown as Repository<SurveyVersion>,
    );
  });

  it('lista sólo cuestionarios con una versión publicada', async () => {
    listBuilder.getRawMany.mockResolvedValue([
      {
        code: 'diagnostico',
        name: 'Diagnóstico',
        description: null,
        versionNumber: 2,
        versionTitle: 'Versión publicada',
        publishedAt: new Date('2026-01-01'),
      },
    ]);

    await expect(service.listAvailable()).resolves.toEqual([
      expect.objectContaining({
        code: 'diagnostico',
        versionNumber: 2,
      }),
    ]);
    expect(listBuilder.distinctOn).toHaveBeenCalledWith(['version.surveyId']);
  });

  it('devuelve la última versión publicada con contenido ordenado', async () => {
    surveysRepository.findOneBy.mockResolvedValue(
      survey({ id: 'survey-1', code: 'diagnostico', name: 'Diagnóstico' }),
    );
    versionsRepository.findOne.mockResolvedValue(
      version({
        id: 'version-2',
        surveyId: 'survey-1',
        versionNumber: 2,
        dimensions: [
          {
            id: 'dimension-1',
            code: 'entorno',
            title: 'Entorno saludable',
            description: null,
            order: 0,
            sections: [
              {
                id: 'section-1',
                code: 'general',
                title: 'Datos generales',
                description: null,
                order: 0,
                questions: [
                  {
                    id: 'question-1',
                    code: 'Q1',
                    type: SurveyQuestionType.SingleChoice,
                    prompt: '¿Cuenta con una política institucional?',
                    helpText: null,
                    required: true,
                    order: 0,
                    validation: {},
                    options: [
                      {
                        id: 'option-1',
                        questionId: 'question-1',
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
          } as SurveyDimension,
        ],
      }),
    );

    const published = await service.findAvailableByCode('diagnostico');

    expect(published.version.versionNumber).toBe(2);
    expect(published.version.dimensions[0].sections[0].questions[0]).toEqual(
      expect.objectContaining({ code: 'Q1', required: true }),
    );
    expect(
      published.version.dimensions[0].sections[0].questions[0].options[0],
    ).toEqual(expect.objectContaining({ value: 'si', score: 100 }));
    expect(versionsRepository.findOne).toHaveBeenCalledTimes(1);
  });

  it('no expone un cuestionario sin versión publicada', async () => {
    surveysRepository.findOneBy.mockResolvedValue(
      survey({ id: 'survey-1', code: 'diagnostico', name: 'Diagnóstico' }),
    );
    versionsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.findAvailableByCode('diagnostico'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

function survey(overrides: Partial<Survey>): Survey {
  return {
    id: 'survey-id',
    code: 'survey-code',
    name: 'Cuestionario',
    description: null,
    isActive: true,
    versions: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function version(overrides: Partial<SurveyVersion>): SurveyVersion {
  return {
    id: 'version-id',
    surveyId: 'survey-id',
    survey: {} as Survey,
    versionNumber: 1,
    title: 'Versión publicada',
    instructions: null,
    status: SurveyVersionStatus.Published,
    publishedAt: new Date('2026-01-01'),
    dimensions: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}
