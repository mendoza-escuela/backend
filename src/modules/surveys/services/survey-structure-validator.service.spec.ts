import { BadRequestException } from '@nestjs/common';
import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import { OfficialSurveyDimensionCode } from '../templates/official-survey-dimensions.template';
import { SurveyStructureValidator } from './survey-structure-validator.service';

describe('SurveyStructureValidator', () => {
  const validator = new SurveyStructureValidator();

  it('permite guardar un borrador todavía vacío', () => {
    expect(() => validator.validate([], false)).not.toThrow();
  });

  it('rechaza publicar una estructura vacía', () => {
    expect(() => validator.validate([], true)).toThrow(BadRequestException);
  });

  it('detecta códigos repetidos sin distinguir mayúsculas', () => {
    const dimensions = [
      dimension({ code: 'entorno' }),
      dimension({ code: 'ENTORNO' }),
    ];

    expectValidationError(dimensions, false, 'está repetido');
  });

  it('exige opciones para preguntas de selección al publicar', () => {
    const dimensions = [
      dimension({
        sections: [
          section({
            questions: [question({ type: SurveyQuestionType.SingleChoice })],
          }),
        ],
      }),
    ];

    expectValidationError(dimensions, true, 'al menos una opción');
  });

  it('rechaza opciones en tipos que no son de selección', () => {
    const dimensions = [
      dimension({
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.Boolean,
                options: [{ value: 'si', label: 'Sí' }],
              }),
            ],
          }),
        ],
      }),
    ];

    expectValidationError(dimensions, false, 'no admite opciones');
  });

  it('valida rangos y límites de selección', () => {
    const dimensions = [
      dimension({
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.MultipleChoice,
                validation: { min: 10, max: 2, maxSelections: 3 },
                options: [
                  { value: 'a', label: 'A' },
                  { value: 'b', label: 'B' },
                ],
              }),
            ],
          }),
        ],
      }),
    ];

    expectValidationError(dimensions, false, 'mínimo no puede superar');
    expectValidationError(dimensions, false, 'máximo de selecciones supera');
  });

  it('exige puntaje en cada opción antes de publicar', () => {
    const dimensions = [
      dimension({
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.SingleChoice,
                options: [{ value: 'si', label: 'Sí' }],
              }),
            ],
          }),
        ],
      }),
    ];

    expectValidationError(dimensions, true, 'debe tener un puntaje');
  });

  it('acepta puntajes enteros entre 0 y 100', () => {
    const dimensions = [
      dimension({
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.SingleChoice,
                options: [{ value: 'si', label: 'Sí', score: 100 }],
              }),
            ],
          }),
        ],
      }),
    ];

    expect(() => validator.validate(dimensions, true)).not.toThrow();
  });

  it('permite guardar un borrador con etiquetas de opción duplicadas', () => {
    const dimensions = [
      dimension({
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.SingleChoice,
                options: [
                  { value: 'ocasional_1', label: 'Respuesta ocasional' },
                  { value: 'ocasional_2', label: 'Respuesta ocasional' },
                ],
              }),
            ],
          }),
        ],
      }),
    ];

    expect(() => validator.validate(dimensions, false)).not.toThrow();
  });

  it('rechaza publicar etiquetas de opción duplicadas aunque sus códigos sean distintos', () => {
    const dimensions = [
      dimension({
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.SingleChoice,
                options: [
                  {
                    value: 'ocasional_1',
                    label:
                      'Se abordan ocasionalmente o sin enfoque sistemático',
                    score: 50,
                  },
                  {
                    value: 'ocasional_2',
                    label:
                      '  SE ABORDAN OCASIONALMENTE O SIN ENFOQUE SISTEMÁTICO  ',
                    score: 0,
                  },
                ],
              }),
            ],
          }),
        ],
      }),
    ];

    expectValidationError(dimensions, true, 'etiqueta de opción');
    expectValidationError(dimensions, true, 'está duplicada');
  });

  it('restringe el cuestionario institucional a selección simple', () => {
    const dimensions = [
      dimension({
        code: OfficialSurveyDimensionCode.InstitutionalCommitment,
        sections: [
          section({
            questions: [question({ type: SurveyQuestionType.Boolean })],
          }),
        ],
      }),
    ];

    expectValidationError(dimensions, false, 'sólo admite selección simple');
  });

  it('rechaza Otro y No aplica en el cuestionario institucional', () => {
    const dimensions = [
      dimension({
        code: OfficialSurveyDimensionCode.InstitutionalCommitment,
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.SingleChoice,
                options: [{ value: 'no_aplica', label: 'No aplica', score: 0 }],
              }),
            ],
          }),
        ],
      }),
    ];

    expectValidationError(dimensions, false, 'no admite “Otro”');
  });

  it('permite otro dentro de una frase que no representa una opción autónoma', () => {
    const dimensions = [
      dimension({
        code: OfficialSurveyDimensionCode.InstitutionalCommitment,
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.SingleChoice,
                options: [
                  {
                    value: 'enfoque_integral',
                    label:
                      'Implementa Escuelas Promotoras u otro enfoque de promoción de la salud',
                    score: 100,
                  },
                ],
              }),
            ],
          }),
        ],
      }),
    ];

    expect(() => validator.validate(dimensions, false)).not.toThrow();
  });

  it('aplica las escalas aprobadas según la dimensión', () => {
    const generalDimensions = [
      dimension({
        code: OfficialSurveyDimensionCode.InstitutionalCommitment,
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.SingleChoice,
                options: [{ value: 'medio', label: 'Medio', score: 66 }],
              }),
            ],
          }),
        ],
      }),
    ];
    const mentalHealthDimensions = [
      dimension({
        code: OfficialSurveyDimensionCode.MentalHealth,
        sections: [
          section({
            questions: [
              question({
                type: SurveyQuestionType.SingleChoice,
                options: [{ value: 'medio', label: 'Medio', score: 66 }],
              }),
            ],
          }),
        ],
      }),
    ];

    expectValidationError(generalDimensions, false, '0, 50, 100');
    expect(() =>
      validator.validate(mentalHealthDimensions, false),
    ).not.toThrow();
  });
});

function expectValidationError(
  dimensions: SurveyDimensionInputDto[],
  requireContent: boolean,
  expectedMessage: string,
) {
  try {
    new SurveyStructureValidator().validate(dimensions, requireContent);
    throw new Error('Se esperaba un error de validación.');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      errors: string[];
    };
    expect(response.errors).toEqual(
      expect.arrayContaining([expect.stringContaining(expectedMessage)]),
    );
  }
}

function dimension(
  overrides: Partial<SurveyDimensionInputDto> = {},
): SurveyDimensionInputDto {
  return {
    code: 'dimension',
    title: 'Dimensión',
    sections: [],
    ...overrides,
  };
}

function section(
  overrides: Partial<SurveyDimensionInputDto['sections'][number]> = {},
): SurveyDimensionInputDto['sections'][number] {
  return {
    code: 'section',
    title: 'Sección',
    questions: [],
    ...overrides,
  };
}

function question(
  overrides: Partial<
    SurveyDimensionInputDto['sections'][number]['questions'][number]
  > = {},
): SurveyDimensionInputDto['sections'][number]['questions'][number] {
  return {
    code: 'question',
    type: SurveyQuestionType.Boolean,
    prompt: '¿Pregunta?',
    required: false,
    validation: {},
    options: [],
    ...overrides,
  };
}
