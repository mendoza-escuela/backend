import 'reflect-metadata';
import { validate } from 'class-validator';
import { EvaluationStarRangeInputDto } from './evaluation-configuration.dto';

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
