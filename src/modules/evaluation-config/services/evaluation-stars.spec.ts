import { EvaluationConfiguration } from '../entities/evaluation-configuration.entity';
import { EvaluationConfigurationsService } from './evaluation-configurations.service';

describe('versioned star ranges', () => {
  const service = new EvaluationConfigurationsService({} as never, {} as never);
  const configuration = {
    starRanges: [
      {
        stars: 1,
        lowerBound: '0',
        upperBound: '20',
        lowerInclusive: true,
        upperInclusive: true,
        order: 1,
      },
      {
        stars: 2,
        lowerBound: '20',
        upperBound: '40',
        lowerInclusive: false,
        upperInclusive: true,
        order: 2,
      },
      {
        stars: 3,
        lowerBound: '40',
        upperBound: '60',
        lowerInclusive: false,
        upperInclusive: true,
        order: 3,
      },
      {
        stars: 4,
        lowerBound: '60',
        upperBound: '80',
        lowerInclusive: false,
        upperInclusive: true,
        order: 4,
      },
      {
        stars: 5,
        lowerBound: '80',
        upperBound: '100',
        lowerInclusive: false,
        upperInclusive: true,
        order: 5,
      },
    ],
  } as EvaluationConfiguration;
  it.each([
    [0, 1],
    [20, 1],
    [20.0001, 2],
    [21, 2],
    [40, 2],
    [40.0001, 3],
    [41, 3],
    [60, 3],
    [60.0001, 4],
    [61, 4],
    [80, 4],
    [80.0001, 5],
    [81, 5],
    [100, 5],
  ])('maps %s to %s stars', (score, stars) =>
    expect(service.resolveStars(configuration, score)).toBe(stars),
  );
  it.each([
    [32.9999, true],
    [33, false],
    [0, true],
    [100, false],
  ])('classifies mental health %s critical=%s', (score, critical) =>
    expect(
      service.evaluate(
        {
          ...configuration,
          mentalHealthCriticalThreshold: '33',
          mentalHealthMaxStars: 4,
        },
        90,
        score,
      ).isMentalHealthCritical,
    ).toBe(critical),
  );
  it('limits only five base stars and preserves the base value', () =>
    expect(
      service.evaluate(
        {
          ...configuration,
          mentalHealthCriticalThreshold: '33',
          mentalHealthMaxStars: 4,
        },
        90,
        32.9999,
      ),
    ).toEqual({
      baseStars: 5,
      finalStars: 4,
      isMentalHealthCritical: true,
      causedBlocking: true,
    }));
  it('does not reduce four base stars for critical mental health', () =>
    expect(
      service.evaluate(
        {
          ...configuration,
          mentalHealthCriticalThreshold: '33',
          mentalHealthMaxStars: 4,
        },
        80,
        0,
      ),
    ).toMatchObject({ baseStars: 4, finalStars: 4, causedBlocking: false }));
});
