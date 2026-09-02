import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { AuthenticatedUser } from '../src/common/types/authenticated-user.type';
import { UserRole } from '../src/modules/users/entities/user-role.enum';
import { AdminSurveysService } from '../src/modules/surveys/services/admin-surveys.service';
import { SurveyStructureValidator } from '../src/modules/surveys/services/survey-structure-validator.service';
import { SurveyVersionComparator } from '../src/modules/surveys/services/survey-version-comparator.service';
import { SurveyVersionCertificationService } from '../src/modules/surveys/services/survey-version-certification.service';
import { SurveyQuestionType } from '../src/modules/surveys/entities/survey-question-type.enum';
import { UpdateSurveyVersionDto } from '../src/modules/surveys/dto/update-survey-version.dto';
import { ApplicabilityRulesService } from '../src/modules/surveys/services/applicability-rules.service';
import { ApplicabilityEngine } from '../src/modules/surveys/services/applicability-engine.service';
import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
} from '../src/modules/surveys/entities/survey-applicability-rule.entity';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase(
  'Survey version publication/mutation serialization (PostgreSQL)',
  () => {
    let dataSource: DataSource;
    let publisher: QueryRunner;
    let ruleWriter: QueryRunner;
    let surveyId: string;
    let versionId: string;
    let questionId: string;
    let conditionId: string;
    let deletableDimensionId: string;
    let deletableRuleId: string;
    let reconciliationService: AdminSurveysService;
    let rulesService: ApplicabilityRulesService;
    let reconciliationSurveyId: string;
    let reconciliationVersionId: string;
    let reconciliationQuestionId: string;
    let reconciliationRuleId: string;
    let actor: AuthenticatedUser;

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: databaseUrl,
        entities: [__dirname + '/../src/modules/**/*.entity{.ts,.js}'],
      });
      await dataSource.initialize();
      const marker = randomUUID().slice(0, 8);
      const [{ id: actorId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO users
           (first_name, last_name, email, password_hash, role,
            is_active, must_change_password)
         VALUES ('Admin', 'Concurrente', $1, 'hash-de-prueba', 'admin', true, false)
         RETURNING id`,
        [`survey-serialization-${marker}@example.com`],
      );
      actor = {
        id: actorId,
        firstName: 'Admin',
        lastName: 'Concurrente',
        email: `survey-serialization-${marker}@example.com`,
        role: UserRole.Admin,
        sessionId: randomUUID(),
        mustChangePassword: false,
        lastLoginAt: null,
      };
      [{ id: surveyId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO surveys (code, name)
         VALUES ($1, 'Serialización de cuestionario') RETURNING id`,
        [`SERIAL-${marker}`],
      );
      [{ id: versionId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_versions
           (survey_id, version_number, title, status)
         VALUES ($1, 1, 'Borrador concurrente', 'draft') RETURNING id`,
        [surveyId],
      );
      const [{ id: dimensionId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_dimensions
           (version_id, code, title, "order")
         VALUES ($1, 'dimension', 'Dimensión', 0) RETURNING id`,
        [versionId],
      );
      const [{ id: sectionId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_sections
           (dimension_id, code, title, "order")
         VALUES ($1, 'section', 'Sección', 0) RETURNING id`,
        [dimensionId],
      );
      [{ id: questionId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_questions
           (section_id, code, type, prompt, required, "order", validation)
         VALUES ($1, 'question', 'boolean', 'Pregunta', false, 0, '{}'::jsonb)
         RETURNING id`,
        [sectionId],
      );
      const [{ id: ruleId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_applicability_rules
           (question_id, group_operator, action, default_action, "order")
         VALUES ($1, 'all', 'omit', 'show', 0) RETURNING id`,
        [questionId],
      );
      [{ id: conditionId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_applicability_conditions
           (rule_id, feature, operator, expected_value, "order")
         VALUES ($1, 'has_kiosk', 'equals', 'true'::jsonb, 0) RETURNING id`,
        [ruleId],
      );

      [{ id: deletableDimensionId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_dimensions
           (version_id, code, title, "order")
         VALUES ($1, 'dimension_delete', 'Dimensión eliminable', 1)
         RETURNING id`,
        [versionId],
      );
      const [{ id: deletableSectionId }] = await dataSource.query<
        { id: string }[]
      >(
        `INSERT INTO survey_sections
           (dimension_id, code, title, "order")
         VALUES ($1, 'section_delete', 'Sección eliminable', 0) RETURNING id`,
        [deletableDimensionId],
      );
      const [{ id: deletableQuestionId }] = await dataSource.query<
        { id: string }[]
      >(
        `INSERT INTO survey_questions
           (section_id, code, type, prompt, required, "order", validation)
         VALUES ($1, 'question_delete', 'boolean', 'Pregunta eliminable', false, 0, '{}'::jsonb)
         RETURNING id`,
        [deletableSectionId],
      );
      [{ id: deletableRuleId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_applicability_rules
           (question_id, group_operator, action, default_action, "order")
         VALUES ($1, 'all', 'omit', 'show', 0) RETURNING id`,
        [deletableQuestionId],
      );
      await dataSource.query(
        `INSERT INTO survey_applicability_conditions
           (rule_id, feature, operator, expected_value, "order")
         VALUES ($1, 'has_kiosk', 'equals', 'true'::jsonb, 0)`,
        [deletableRuleId],
      );

      const [{ id: editableSurveyId }] = await dataSource.query<
        { id: string }[]
      >(
        `INSERT INTO surveys (code, name)
         VALUES ($1, 'Reconciliación por identidad') RETURNING id`,
        [`IDENTITY-${marker}`],
      );
      reconciliationSurveyId = editableSurveyId;
      [{ id: reconciliationVersionId }] = await dataSource.query<
        { id: string }[]
      >(
        `INSERT INTO survey_versions
           (survey_id, version_number, title, status)
         VALUES ($1, 1, 'Borrador por identidad', 'draft') RETURNING id`,
        [reconciliationSurveyId],
      );
      const [{ id: firstDimensionId }] = await dataSource.query<
        { id: string }[]
      >(
        `INSERT INTO survey_dimensions
           (version_id, code, title, "order")
         VALUES ($1, 'alpha', 'Alpha', 0) RETURNING id`,
        [reconciliationVersionId],
      );
      const [{ id: secondDimensionId }] = await dataSource.query<
        { id: string }[]
      >(
        `INSERT INTO survey_dimensions
           (version_id, code, title, "order")
         VALUES ($1, 'beta', 'Beta', 1) RETURNING id`,
        [reconciliationVersionId],
      );
      const [{ id: firstSectionId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_sections
           (dimension_id, code, title, "order")
         VALUES ($1, 'first', 'Primera', 0) RETURNING id`,
        [firstDimensionId],
      );
      const [{ id: secondSectionId }] = await dataSource.query<
        { id: string }[]
      >(
        `INSERT INTO survey_sections
           (dimension_id, code, title, "order")
         VALUES ($1, 'second', 'Segunda', 0) RETURNING id`,
        [secondDimensionId],
      );
      [{ id: reconciliationQuestionId }] = await dataSource.query<
        { id: string }[]
      >(
        `INSERT INTO survey_questions
           (section_id, code, type, prompt, required, "order", validation)
         VALUES ($1, 'stable_question', 'boolean', 'Pregunta estable', false, 0, '{}'::jsonb)
         RETURNING id`,
        [firstSectionId],
      );
      await dataSource.query(
        `INSERT INTO survey_questions
           (section_id, code, type, prompt, required, "order", validation)
         VALUES ($1, 'other_question', 'boolean', 'Otra pregunta', false, 0, '{}'::jsonb)`,
        [secondSectionId],
      );
      [{ id: reconciliationRuleId }] = await dataSource.query<{ id: string }[]>(
        `INSERT INTO survey_applicability_rules
           (question_id, group_operator, action, default_action, "order")
         VALUES ($1, 'all', 'omit', 'show', 0) RETURNING id`,
        [reconciliationQuestionId],
      );
      await dataSource.query(
        `INSERT INTO survey_applicability_conditions
           (rule_id, feature, operator, expected_value, "order")
         VALUES ($1, 'has_kiosk', 'equals', 'true'::jsonb, 0)`,
        [reconciliationRuleId],
      );
      reconciliationService = new AdminSurveysService(
        dataSource,
        new SurveyStructureValidator(),
        new SurveyVersionComparator(),
        {} as SurveyVersionCertificationService,
      );
      rulesService = new ApplicabilityRulesService(
        dataSource,
        new ApplicabilityEngine(),
      );

      publisher = dataSource.createQueryRunner();
      ruleWriter = dataSource.createQueryRunner();
      await Promise.all([publisher.connect(), ruleWriter.connect()]);
    });

    afterAll(async () => {
      if (publisher?.isTransactionActive) await publisher.rollbackTransaction();
      if (ruleWriter?.isTransactionActive)
        await ruleWriter.rollbackTransaction();
      await Promise.all([publisher?.release(), ruleWriter?.release()]);
      if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it('allows a draft dimension delete to cascade through questions, rules and conditions', async () => {
      await dataSource.query(`DELETE FROM survey_dimensions WHERE id = $1`, [
        deletableDimensionId,
      ]);

      const [{ count }] = await dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count
         FROM survey_applicability_rules WHERE id = $1`,
        [deletableRuleId],
      );
      expect(count).toBe('0');
    });

    it('reconciles rename, move, swaps and delete/reuse by UUID without transferring rules', async () => {
      const before = await reconciliationService.findVersion(
        reconciliationSurveyId,
        reconciliationVersionId,
      );
      const input = versionWriteInput(before);
      const [firstDimension, secondDimension] = input.dimensions;
      firstDimension.code = 'beta';
      secondDimension.code = 'alpha';
      input.dimensions = [secondDimension, firstDimension];
      const [movedQuestion] = firstDimension.sections[0].questions.splice(0, 1);
      movedQuestion.code = 'renamed_question';
      secondDimension.sections[0].questions.push(movedQuestion);

      const afterMove = await reconciliationService.updateVersion(
        reconciliationSurveyId,
        reconciliationVersionId,
        input,
        actor,
      );

      const [persistedRule] = await dataSource.query<
        { questionId: string; code: string; sectionId: string }[]
      >(
        `SELECT rule.question_id AS "questionId", question.code,
                question.section_id AS "sectionId"
         FROM survey_applicability_rules rule
         JOIN survey_questions question ON question.id = rule.question_id
         WHERE rule.id = $1`,
        [reconciliationRuleId],
      );
      expect(persistedRule).toMatchObject({
        questionId: reconciliationQuestionId,
        code: 'renamed_question',
      });
      expect(new Date(afterMove.updatedAt).getTime()).toBeGreaterThan(
        new Date(before.updatedAt).getTime(),
      );
      expect(afterMove.dimensions.map(({ code }) => code)).toEqual([
        'alpha',
        'beta',
      ]);
      await expect(
        reconciliationService.updateVersion(
          reconciliationSurveyId,
          reconciliationVersionId,
          input,
          actor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      const reuseInput = versionWriteInput(afterMove);
      for (const dimension of reuseInput.dimensions)
        for (const section of dimension.sections)
          section.questions = section.questions.filter(
            ({ id }) => id !== reconciliationQuestionId,
          );
      reuseInput.dimensions[0].sections[0].questions.push({
        id: null,
        code: 'renamed_question',
        type: SurveyQuestionType.Boolean,
        prompt: 'Nueva pregunta con el código reutilizado',
        helpText: null,
        required: false,
        validation: {},
        options: [],
      });

      await reconciliationService.updateVersion(
        reconciliationSurveyId,
        reconciliationVersionId,
        reuseInput,
        actor,
      );

      const [replacement] = await dataSource.query<
        { id: string; ruleCount: string }[]
      >(
        `SELECT question.id, COUNT(rule.id)::text AS "ruleCount"
         FROM survey_questions question
         LEFT JOIN survey_applicability_rules rule
           ON rule.question_id = question.id
         JOIN survey_sections section ON section.id = question.section_id
         JOIN survey_dimensions dimension ON dimension.id = section.dimension_id
         WHERE dimension.version_id = $1 AND question.code = 'renamed_question'
         GROUP BY question.id`,
        [reconciliationVersionId],
      );
      expect(replacement.id).not.toBe(reconciliationQuestionId);
      expect(replacement.ruleCount).toBe('0');
      const [{ count: oldRuleCount }] = await dataSource.query<
        { count: string }[]
      >(
        `SELECT COUNT(*)::text AS count
         FROM survey_applicability_rules WHERE id = $1`,
        [reconciliationRuleId],
      );
      expect(oldRuleCount).toBe('0');
    });

    it('serializes two structural writes with the same revision and accepts exactly one', async () => {
      const before = await reconciliationService.findVersion(
        reconciliationSurveyId,
        reconciliationVersionId,
      );
      const firstInput = versionWriteInput(before);
      firstInput.title = 'Edición concurrente A';
      const secondInput = versionWriteInput(before);
      secondInput.title = 'Edición concurrente B';

      const outcomes = await Promise.allSettled([
        reconciliationService.updateVersion(
          reconciliationSurveyId,
          reconciliationVersionId,
          firstInput,
          actor,
        ),
        reconciliationService.updateVersion(
          reconciliationSurveyId,
          reconciliationVersionId,
          secondInput,
          actor,
        ),
      ]);

      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      const rejected = outcomes.filter(
        (outcome) => outcome.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0]?.status === 'rejected') {
        expect(rejected[0].reason).toBeInstanceOf(ConflictException);
        expect(
          (rejected[0].reason as ConflictException).getResponse(),
        ).toMatchObject({ code: 'SURVEY_VERSION_EDIT_CONFLICT' });
      }

      const after = await reconciliationService.findVersion(
        reconciliationSurveyId,
        reconciliationVersionId,
      );
      expect(['Edición concurrente A', 'Edición concurrente B']).toContain(
        after.title,
      );
      expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(
        new Date(before.updatedAt).getTime(),
      );
    });

    it('accepts only one of two rule writes that start from the same revision', async () => {
      const [{ updatedAt }] = await dataSource.query<
        { updatedAt: Date | string }[]
      >(`SELECT updated_at AS "updatedAt" FROM survey_versions WHERE id = $1`, [
        versionId,
      ]);
      const expectedUpdatedAt = new Date(updatedAt).toISOString();
      const createRule = (expectedValue: boolean) =>
        rulesService.create(
          surveyId,
          versionId,
          questionId,
          {
            expectedUpdatedAt,
            groupOperator: ApplicabilityGroupOperator.All,
            action: ApplicabilityAction.Omit,
            defaultAction: ApplicabilityAction.Show,
            order: 1,
            conditions: [
              {
                feature: 'has_kiosk',
                operator: 'equals',
                expectedValue,
                order: 0,
              },
            ],
          },
          actor,
        );

      const outcomes = await Promise.allSettled([
        createRule(true),
        createRule(false),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome) => outcome.status === 'rejected',
      );
      expect(rejected?.status).toBe('rejected');
      if (rejected?.status === 'rejected') {
        expect(rejected.reason).toBeInstanceOf(ConflictException);
        expect(
          (rejected.reason as ConflictException).getResponse(),
        ).toMatchObject({ code: 'SURVEY_VERSION_EDIT_CONFLICT' });
      }
    });

    it('keeps the rules list and revision in one shared-lock snapshot', async () => {
      await publisher.startTransaction();
      await ruleWriter.startTransaction();

      const [revision] = (await publisher.query(
        `SELECT updated_at AS "updatedAt"
         FROM survey_versions WHERE id = $1 FOR SHARE`,
        [versionId],
      )) as Array<{ updatedAt: Date | string }>;
      const mutation = ruleWriter
        .query(
          `UPDATE survey_applicability_conditions
           SET expected_value = 'false'::jsonb
           WHERE id = $1`,
          [conditionId],
        )
        .then(() => ({ state: 'resolved' as const }));

      const whileSnapshotIsOpen = await Promise.race([
        mutation,
        new Promise<{ state: 'blocked' }>((resolve) =>
          setTimeout(() => resolve({ state: 'blocked' }), 150),
        ),
      ]);
      expect(whileSnapshotIsOpen.state).toBe('blocked');
      const [condition] = (await publisher.query(
        `SELECT expected_value AS "expectedValue"
         FROM survey_applicability_conditions WHERE id = $1`,
        [conditionId],
      )) as Array<{ expectedValue: boolean }>;
      expect(condition.expectedValue).toBe(true);
      expect(new Date(revision.updatedAt).toISOString()).toBeTruthy();

      await publisher.commitTransaction();
      await expect(mutation).resolves.toEqual({ state: 'resolved' });
      await ruleWriter.rollbackTransaction();
    });

    it('makes a direct rule mutation wait for publication and then reject the published version', async () => {
      await publisher.startTransaction();
      await ruleWriter.startTransaction();

      await publisher.query(
        `UPDATE survey_versions
         SET status = 'published', published_at = clock_timestamp()
         WHERE id = $1`,
        [versionId],
      );

      const mutation = ruleWriter
        .query(
          `UPDATE survey_applicability_conditions
           SET expected_value = 'false'::jsonb
           WHERE id = $1`,
          [conditionId],
        )
        .then(
          () => ({ state: 'resolved' as const }),
          (error: { code?: string; message?: string }) => ({
            state: 'rejected' as const,
            error,
          }),
        );

      const whilePublicationIsOpen = await Promise.race([
        mutation,
        new Promise<{ state: 'blocked' }>((resolve) =>
          setTimeout(() => resolve({ state: 'blocked' }), 150),
        ),
      ]);
      expect(whilePublicationIsOpen.state).toBe('blocked');

      await publisher.commitTransaction();
      const afterPublication = await mutation;
      expect(afterPublication.state).toBe('rejected');
      if (afterPublication.state === 'rejected') {
        expect(afterPublication.error.code).toBe('23514');
        expect(afterPublication.error.message).toContain(
          'Sólo las versiones borrador son mutables',
        );
      }
      await ruleWriter.rollbackTransaction();
    });
  },
);

function versionWriteInput(version: {
  title: string;
  instructions: string | null;
  updatedAt: Date | string;
  dimensions: Array<{
    id: string;
    code: string;
    title: string;
    description: string | null;
    sections: Array<{
      id: string;
      code: string;
      title: string;
      description: string | null;
      questions: Array<{
        id: string;
        code: string;
        type: SurveyQuestionType;
        prompt: string;
        helpText: string | null;
        required: boolean;
        validation: Record<string, unknown>;
        options: Array<{
          id: string;
          value: string;
          label: string;
          helpText: string | null;
          score: number | null;
        }>;
      }>;
    }>;
  }>;
}): UpdateSurveyVersionDto {
  return {
    expectedUpdatedAt: new Date(version.updatedAt).toISOString(),
    title: version.title,
    instructions: version.instructions,
    dimensions: version.dimensions.map((dimension) => ({
      id: dimension.id,
      code: dimension.code,
      title: dimension.title,
      description: dimension.description,
      sections: dimension.sections.map((section) => ({
        id: section.id,
        code: section.code,
        title: section.title,
        description: section.description,
        questions: section.questions.map((question) => ({
          id: question.id,
          code: question.code,
          type: question.type,
          prompt: question.prompt,
          helpText: question.helpText,
          required: question.required,
          validation: question.validation,
          options: question.options.map((option) => ({
            id: option.id,
            value: option.value,
            label: option.label,
            helpText: option.helpText,
            score: option.score,
          })),
        })),
      })),
    })),
  };
}
