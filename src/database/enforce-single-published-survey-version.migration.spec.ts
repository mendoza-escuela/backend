import { QueryRunner } from 'typeorm';
import { EnforceSinglePublishedSurveyVersion1720375218000 } from '../migrations/1720375218000-EnforceSinglePublishedSurveyVersion';

describe('EnforceSinglePublishedSurveyVersion migration', () => {
  const query = jest.fn();
  const queryRunner = { query } as unknown as QueryRunner;
  const migration = new EnforceSinglePublishedSurveyVersion1720375218000();

  beforeEach(() => jest.clearAllMocks());

  it('detecta inconsistencias antes de crear el índice único parcial', async () => {
    await migration.up(queryRunner);
    const queries = query.mock.calls.map(([statement]) => statement as string);
    expect(queries[0]).toContain('HAVING COUNT(*) > 1');
    expect(queries[0]).toContain('Archive manualmente');
    expect(queries[1]).toContain('CREATE UNIQUE INDEX');
    expect(queries[1]).toContain(`WHERE "status" = 'published'`);
  });

  it('el rollback elimina solamente el índice agregado', async () => {
    await migration.down(queryRunner);
    expect(query).toHaveBeenCalledWith(
      'DROP INDEX "public"."UQ_survey_versions_single_published"',
    );
  });
});
