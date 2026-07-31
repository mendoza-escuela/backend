import { BadRequestException } from '@nestjs/common';
import { EvaluationConfigurationValidator } from './evaluation-configuration-validator.service';

describe('EvaluationConfigurationValidator', () => {
  const validator = new EvaluationConfigurationValidator();
  const valid = () => [
    {
      stars: 1,
      lowerBound: 0,
      upperBound: 20,
      lowerInclusive: true,
      upperInclusive: true,
      order: 1,
    },
    {
      stars: 2,
      lowerBound: 20,
      upperBound: 40,
      lowerInclusive: false,
      upperInclusive: true,
      order: 2,
    },
    {
      stars: 3,
      lowerBound: 40,
      upperBound: 60,
      lowerInclusive: false,
      upperInclusive: true,
      order: 3,
    },
    {
      stars: 4,
      lowerBound: 60,
      upperBound: 80,
      lowerInclusive: false,
      upperInclusive: true,
      order: 4,
    },
    {
      stars: 5,
      lowerBound: 80,
      upperBound: 100,
      lowerInclusive: false,
      upperInclusive: true,
      order: 5,
    },
  ];

  it('accepts the approved exact 0-100 coverage', () =>
    expect(() => validator.validate(valid())).not.toThrow());
  it.each([
    [
      'gap',
      () => {
        const ranges = valid();
        ranges[1].lowerBound = 21;
        return ranges;
      },
    ],
    [
      'overlap',
      () => {
        const ranges = valid();
        ranges[1].lowerInclusive = true;
        return ranges;
      },
    ],
    [
      'duplicate stars',
      () => {
        const ranges = valid();
        ranges[1].stars = 1;
        return ranges;
      },
    ],
    ['missing category', () => valid().slice(0, 4)],
    [
      'reversed limits',
      () => {
        const ranges = valid();
        ranges[2].lowerBound = 61;
        ranges[2].upperBound = 60;
        return ranges;
      },
    ],
  ])('rejects %s', (_name, build) =>
    expect(() => validator.validate(build())).toThrow(BadRequestException),
  );
});
