import 'reflect-metadata';
import { validate } from 'class-validator';
import {
  CreateEvaluationConfigurationDto,
  EvaluationStarRangeInputDto,
} from './evaluation-configuration.dto';

describe('EvaluationStarRangeInputDto', () => {
  it('acepta límites enteros y rechaza límites decimales', async () => {
    const range = Object.assign(new EvaluationStarRangeInputDto(), {
      stars: 2,
      lowerBound: 20.5,
      upperBound: 40,
      lowerInclusive: false,
      upperInclusive: true,
      order: 2,
    });

    expect((await validate(range)).map(({ property }) => property)).toContain(
      'lowerBound',
    );

    range.lowerBound = 20;
    await expect(validate(range)).resolves.toHaveLength(0);
  });
});

describe('CreateEvaluationConfigurationDto', () => {
  it('rechaza un umbral decimal o negativo', async () => {
    const configuration = Object.assign(
      new CreateEvaluationConfigurationDto(),
      {
        versionCode: 'v1',
        name: 'Configuración',
        mentalHealthCriticalThreshold: 33.5,
        mentalHealthMaxStars: 4,
        starRanges: [],
      },
    );

    expect(
      (await validate(configuration)).map(({ property }) => property),
    ).toContain('mentalHealthCriticalThreshold');

    configuration.mentalHealthCriticalThreshold = -1;
    expect(
      (await validate(configuration)).map(({ property }) => property),
    ).toContain('mentalHealthCriticalThreshold');
  });
});
