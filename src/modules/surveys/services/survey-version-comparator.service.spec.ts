import { SurveyDimension } from '../entities/survey-dimension.entity';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { SurveyVersion } from '../entities/survey-version.entity';
import { Survey } from '../entities/survey.entity';
import { SurveyVersionComparator } from './survey-version-comparator.service';

describe('SurveyVersionComparator', () => {
  const comparator = new SurveyVersionComparator();

  it('detecta altas, bajas y modificaciones usando códigos estables', () => {
    const from = version({
      id: 'from',
      versionNumber: 1,
      dimensions: [
        dimension('entorno', 'Entorno', [
          question('politica', '¿Tiene una política?', [
            option('si', 'Sí'),
            option('no', 'No'),
          ]),
          question('eliminada', 'Pregunta anterior'),
        ]),
      ],
    });
    const to = version({
      id: 'to',
      versionNumber: 2,
      dimensions: [
        dimension('entorno', 'Entorno saludable', [
          question('politica', '¿Cuenta con una política?', [
            option('si', 'Sí, cuenta'),
            option('no', 'No'),
          ]),
          question('agregada', 'Pregunta nueva'),
        ]),
      ],
    });

    const result = comparator.compare(from, to);

    expect(result.summary).toEqual({
      added: 1,
      removed: 1,
      modified: 3,
      total: 5,
    });
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'modified',
          entityType: 'dimension',
          path: 'entorno',
          changedFields: ['title'],
        }),
        expect.objectContaining({
          type: 'modified',
          entityType: 'question',
          path: 'entorno/general/politica',
          changedFields: ['prompt'],
        }),
        expect.objectContaining({
          type: 'added',
          entityType: 'question',
          path: 'entorno/general/agregada',
        }),
        expect.objectContaining({
          type: 'removed',
          entityType: 'question',
          path: 'entorno/general/eliminada',
        }),
      ]),
    );
  });

  it('no informa cambios para estructuras equivalentes', () => {
    const from = version({ id: 'from' });
    const to = version({ id: 'to', versionNumber: 2 });

    expect(comparator.compare(from, to).summary.total).toBe(0);
  });

  it('incluye cambios en título e instrucciones de la versión', () => {
    const from = version({ id: 'from', instructions: 'Texto anterior' });
    const to = version({
      id: 'to',
      versionNumber: 2,
      title: 'Versión revisada',
      instructions: 'Texto nuevo',
    });

    expect(comparator.compare(from, to).changes).toContainEqual(
      expect.objectContaining({
        type: 'modified',
        entityType: 'version',
        path: 'versión',
        changedFields: ['title', 'instructions'],
      }),
    );
  });

  it('detecta cambios de puntaje en las opciones', () => {
    const from = version({
      id: 'from',
      dimensions: [
        dimension('entorno', 'Entorno', [
          question('politica', '¿Tiene una política?', [
            option('si', 'Sí', 50),
          ]),
        ]),
      ],
    });
    const to = version({
      id: 'to',
      versionNumber: 2,
      dimensions: [
        dimension('entorno', 'Entorno', [
          question('politica', '¿Tiene una política?', [
            option('si', 'Sí', 100),
          ]),
        ]),
      ],
    });

    expect(comparator.compare(from, to).changes).toContainEqual(
      expect.objectContaining({
        entityType: 'option',
        changedFields: ['score'],
      }),
    );
  });
});

function version(overrides: Partial<SurveyVersion>): SurveyVersion {
  return {
    id: 'version',
    surveyId: 'survey',
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

function dimension(
  code: string,
  title: string,
  questions: Array<Record<string, unknown>>,
): SurveyDimension {
  return {
    id: `dimension-${code}`,
    versionId: 'version',
    version: {} as SurveyVersion,
    code,
    title,
    description: null,
    order: 0,
    sections: [
      {
        id: 'section-general',
        dimensionId: `dimension-${code}`,
        dimension: {} as SurveyDimension,
        code: 'general',
        title: 'General',
        description: null,
        order: 0,
        questions,
      },
    ],
  } as SurveyDimension;
}

function question(
  code: string,
  prompt: string,
  options: Array<Record<string, unknown>> = [],
) {
  return {
    id: `question-${code}`,
    sectionId: 'section-general',
    code,
    type: SurveyQuestionType.SingleChoice,
    prompt,
    helpText: null,
    required: false,
    order: code === 'politica' ? 0 : 1,
    validation: {},
    options,
  };
}

function option(value: string, label: string, score: number | null = null) {
  return {
    id: `option-${value}`,
    questionId: 'question-politica',
    value,
    label,
    helpText: null,
    score,
    order: value === 'si' ? 0 : 1,
  };
}
