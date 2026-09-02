import { SerializeSurveyVersionMutations1720375224000 } from '../migrations/1720375224000-SerializeSurveyVersionMutations';

describe('SerializeSurveyVersionMutations migration', () => {
  const migration = new SerializeSurveyVersionMutations1720375224000();

  it('locks the parent version and checks both sides of moved rules', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => queries.push(sql)),
    };

    await migration.up(queryRunner as never);

    expect(queries[0]).toContain('FOR UPDATE');
    expect(queries[0]).toContain('IS NULL THEN RETURN');
    expect(queries[0]).toContain(`"target_status" <> 'draft'`);
    expect(queries[1]).toContain(`TG_OP <> 'INSERT'`);
    expect(queries[1]).toContain(`OLD."question_id"`);
    expect(queries[1]).toContain(`NEW."question_id"`);
    expect(queries[2]).toContain(`OLD."rule_id"`);
    expect(queries[2]).toContain(`NEW."rule_id"`);
  });

  it('restores the previous non-locking functions on rollback', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => queries.push(sql)),
    };

    await migration.down(queryRunner as never);

    expect(queries[0]).not.toContain('FOR UPDATE');
    expect(queries[1]).toContain(
      `COALESCE(NEW."question_id", OLD."question_id")`,
    );
    expect(queries[2]).toContain(`COALESCE(NEW."rule_id", OLD."rule_id")`);
  });
});
