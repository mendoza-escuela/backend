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

  it('maps a duplicated version code to a specific 409 response', async () => {
    const duplicateService = new EvaluationConfigurationsService(
      {
        transaction: jest.fn().mockRejectedValue({
          code: '23505',
          constraint: 'UQ_evaluation_configurations_version_code',
        }),
      } as unknown as DataSource,
      validator,
    );

    const promise = duplicateService.create(
      {
        versionCode: 'v1.0.0',
        name: 'Duplicada',
        mentalHealthCriticalThreshold: 33,
        mentalHealthMaxStars: 4,
        starRanges: [],
      },
      'actor-id',
    );

    await expect(promise).rejects.toMatchObject({
      response: {
        code: 'EVALUATION_VERSION_CODE_CONFLICT',
        field: 'versionCode',
        message: 'Ya existe una configuración con ese código de versión.',
      },
      status: 409,
    });
  });

  it('maps a duplicated version code when editing a draft', async () => {
    const duplicateService = new EvaluationConfigurationsService(
      {
        transaction: jest.fn().mockRejectedValue({
          driverError: {
            code: '23505',
            constraint: 'UQ_evaluation_configurations_version_code',
          },
        }),
      } as unknown as DataSource,
      validator,
    );

    await expect(
      duplicateService.update(
        'configuration-id',
        {
          versionCode: 'v1.0.0',
          name: 'Duplicada',
          mentalHealthCriticalThreshold: 33,
          mentalHealthMaxStars: 4,
          starRanges: [],
        },
        'actor-id',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'EVALUATION_VERSION_CODE_CONFLICT',
        field: 'versionCode',
      },
      status: 409,
    });
  });

  it('maps a duplicated version code when cloning', async () => {
    const duplicateService = new EvaluationConfigurationsService(
      {
        transaction: jest.fn().mockRejectedValue({
          code: '23505',
          constraint: 'UQ_evaluation_configurations_version_code',
        }),
      } as unknown as DataSource,
      validator,
    );
    jest.spyOn(duplicateService, 'get').mockResolvedValue({
      id: 'source-id',
      versionCode: 'v1.0.0',
      name: 'Original',
      description: null,
      mentalHealthCriticalThreshold: '33',
      mentalHealthMaxStars: 4,
      metadata: {},
      starRanges: [],
    } as EvaluationConfiguration);

    await expect(
      duplicateService.clone(
        'source-id',
        { versionCode: 'v1.0.0', name: 'Copia' },
        'actor-id',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'EVALUATION_VERSION_CODE_CONFLICT',
        field: 'versionCode',
      },
      status: 409,
    });
  });
});
