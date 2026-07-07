import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns the service status', () => {
    const service = new HealthService({ query: jest.fn() } as never);

    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        status: 'ok',
      }),
    );
  });

  it('checks the database connection', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const service = new HealthService({ query } as never);

    await expect(service.getDatabaseStatus()).resolves.toEqual(
      expect.objectContaining({
        database: 'postgres',
        status: 'ok',
      }),
    );
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });
});
