import { QueryRunner } from 'typeorm';
import { SeedOfficialSchoolCatalogs1720375221000 } from '../migrations/1720375221000-SeedOfficialSchoolCatalogs';

describe('SeedOfficialSchoolCatalogs1720375221000', () => {
  const executedQueries: Array<{ sql: string; parameters?: unknown[] }> = [];
  const query = jest.fn((sql: string, parameters?: unknown[]) => {
    executedQueries.push({ sql, parameters });
    return Promise.resolve(undefined);
  });
  const queryRunner = {
    query,
  } as unknown as QueryRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    executedQueries.length = 0;
  });

  it('siembra de forma idempotente los valores oficiales y migra sólo coincidencias normalizadas', async () => {
    await new SeedOfficialSchoolCatalogs1720375221000().up(queryRunner);

    const calls = executedQueries;
    expect(calls).toHaveLength(12);
    expect(
      calls
        .slice(0, 10)
        .every(({ sql }) => sql.includes('ON CONFLICT ("code") DO UPDATE')),
    ).toBe(true);
    expect(calls.map(({ parameters }) => parameters).flat(2)).toEqual(
      expect.arrayContaining([
        'Ampliación primaria (convenio Nación)',
        'Fortalecimiento de trayectorias',
        'Inicial',
        'Superior',
      ]),
    );
    expect(calls[10].sql).toContain('HAVING COUNT(*) = 1');
    expect(calls[10].sql).toContain('"shift_catalog_id" IS NULL');
    expect(calls[11].sql).toContain('NOT EXISTS');
    expect(calls[11].sql).toContain('ON CONFLICT DO NOTHING');
  });

  it('no elimina catálogos que ya están en uso durante el rollback', async () => {
    await new SeedOfficialSchoolCatalogs1720375221000().down(queryRunner);

    const sql = executedQueries.map(({ sql }) => sql).join('\n');
    expect(sql).toContain('"school"."shift_catalog_id"');
    expect(sql).toContain('"current"."level_id"');
    expect(sql).toContain('"history"."level_id"');
  });
});
