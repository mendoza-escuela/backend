import { BadRequestException } from '@nestjs/common';
import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
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
