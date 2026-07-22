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
    find: jest.fn(),
    findOneBy: jest.fn(),
  };
  const versionsRepository = {
    find: jest.fn(),
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
    surveysRepository.find.mockResolvedValue([
      survey({ id: 'survey-1', code: 'diagnostico', name: 'Diagnóstico' }),
      survey({ id: 'survey-2', code: 'sin-version', name: 'Sin versión' }),
    ]);
    versionsRepository.find.mockResolvedValue([
      version({
        id: 'version-2',
        surveyId: 'survey-1',
        versionNumber: 2,
      }),
      version({
        id: 'version-1',
        surveyId: 'survey-1',
        versionNumber: 1,
      }),
    ]);

    await expect(service.listAvailable()).resolves.toEqual([
      expect.objectContaining({
        code: 'diagnostico',
        versionNumber: 2,
      }),
    ]);
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
                    type: SurveyQuestionType.Boolean,
                    prompt: '¿Cuenta con una política institucional?',
                    helpText: null,
                    required: true,
                    order: 0,
                    validation: {},
                    options: [],
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
