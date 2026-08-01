import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EvaluationConfigurationStatus } from '../entities/evaluation-configuration-status.enum';
import { EvaluationConfiguration } from '../entities/evaluation-configuration.entity';
import { EvaluationStarRange } from '../entities/evaluation-star-range.entity';
import { EvaluationConfigurationsService } from './evaluation-configurations.service';

describe('EvaluationConfigurationsService', () => {
  const manager = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const validator = { validate: jest.fn() };
  const service = new EvaluationConfigurationsService(
    {} as DataSource,
    validator,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('locks only the active configuration and loads star ranges separately', async () => {
    const configuration = {
      id: 'configuration-id',
      status: EvaluationConfigurationStatus.Active,
    } as EvaluationConfiguration;
    const ranges = [
      {
        configurationId: configuration.id,
        stars: 1,
        lowerBound: '0',
        upperBound: '20',
        lowerInclusive: true,
        upperInclusive: false,
        order: 1,
      },
    ] as EvaluationStarRange[];
    manager.findOne.mockResolvedValue(configuration);
    manager.find.mockResolvedValue(ranges);

    await expect(
      service.active(manager as unknown as EntityManager),
    ).resolves.toBe(configuration);

    expect(manager.findOne).toHaveBeenCalledWith(EvaluationConfiguration, {
      where: { status: EvaluationConfigurationStatus.Active },
      lock: { mode: 'pessimistic_read' },
    });
    expect(manager.find).toHaveBeenCalledWith(EvaluationStarRange, {
      where: { configurationId: configuration.id },
      order: { order: 'ASC' },
    });
    expect(configuration.starRanges).toBe(ranges);
    expect(validator.validate).toHaveBeenCalledTimes(1);
  });

  it('fails safely when no active configuration exists', async () => {
    manager.findOne.mockResolvedValue(null);

    await expect(
      service.active(manager as unknown as EntityManager),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.find).not.toHaveBeenCalled();
  });
});
