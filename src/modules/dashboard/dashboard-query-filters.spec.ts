import 'reflect-metadata';
import { SelectQueryBuilder } from 'typeorm';
import { CampaignParticipationStatus } from '../campaigns/dto/list-campaign-tracking-query.dto';
import { CampaignSchool } from '../campaigns/entities/campaign-school.entity';
import { applyDashboardSchoolFilters } from './dashboard-query-filters';

describe('applyDashboardSchoolFilters', () => {
  it('combina categorías con AND y valores de una categoría mediante IN', () => {
    const builder = queryBuilder();

    applyDashboardSchoolFilters(builder, {
      departments: ['Capital', 'Lavalle'],
      localities: ['Ciudad', 'Costa de Araujo'],
      managementTypes: ['Estatal', 'Privada'],
      scopes: ['Urbano', 'Rural'],
      shifts: ['Simple', 'Completa'],
      schoolIds: [
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
      ],
      educationTypes: ['Educación común', 'Educación especial'],
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'school.department IN (:...departments)',
      { departments: ['Capital', 'Lavalle'] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'school.locality IN (:...localities)',
      { localities: ['Ciudad', 'Costa de Araujo'] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'school.education_level IN (:...educationTypes)',
      { educationTypes: ['Educación común', 'Educación especial'] },
    );
  });

  it('filtra niveles por código mediante EXISTS sin multiplicar escuelas', () => {
    const builder = queryBuilder();

    applyDashboardSchoolFilters(builder, {
      educationLevels: ['primario', 'secundario'],
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringMatching(
        /EXISTS \([\s\S]*school_education_levels[\s\S]*dashboard_education_level\.code IN/,
      ),
      { educationLevels: ['primario', 'secundario'] },
    );
  });

  it('aplica estrellas y áreas críticas con parámetros y EXISTS', () => {
    const builder = queryBuilder();

    applyDashboardSchoolFilters(builder, {
      stars: [1, 3, 5],
      criticalAreas: ['salud_mental', 'actividad_fisica'],
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'evaluation.stars IN (:...stars)',
      { stars: [1, 3, 5] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringMatching(
        /EXISTS \([\s\S]*dashboard_critical_dimension[\s\S]*is_critical = true/,
      ),
      { criticalAreas: ['salud_mental', 'actividad_fisica'] },
    );
  });

  it.each([
    [[CampaignParticipationStatus.NotStarted], 'not-started'],
    [[CampaignParticipationStatus.Draft], 'persisted'],
    [[CampaignParticipationStatus.Submitted], 'persisted'],
    [
      [
        CampaignParticipationStatus.NotStarted,
        CampaignParticipationStatus.Draft,
      ],
      'mixed',
    ],
    [
      [
        CampaignParticipationStatus.NotStarted,
        CampaignParticipationStatus.Submitted,
      ],
      'mixed',
    ],
    [
      [
        CampaignParticipationStatus.Draft,
        CampaignParticipationStatus.Submitted,
      ],
      'persisted',
    ],
    [
      [
        CampaignParticipationStatus.NotStarted,
        CampaignParticipationStatus.Draft,
        CampaignParticipationStatus.Submitted,
      ],
      'all',
    ],
  ] as const)(
    'aplica el subconjunto de estados %j con OR interno',
    (submissionStatuses, expectedKind) => {
      const builder = queryBuilder();

      applyDashboardSchoolFilters(builder, {
        submissionStatuses: [...submissionStatuses],
      });

      const statusCalls = builder.andWhere.mock.calls.filter(([condition]) =>
        String(condition).includes('submission.'),
      );
      if (expectedKind === 'all') {
        expect(statusCalls).toHaveLength(0);
        return;
      }
      expect(statusCalls).toHaveLength(1);
      const [condition, parameters] = statusCalls[0];
      if (expectedKind === 'not-started') {
        expect(condition).toBe('submission.id IS NULL');
        expect(parameters).toBeUndefined();
      } else if (expectedKind === 'mixed') {
        expect(condition).toBe(
          '(submission.id IS NULL OR submission.status IN (:...submissionStatuses))',
        );
      } else {
        expect(condition).toBe('submission.status IN (:...submissionStatuses)');
      }
    },
  );

  it('combina la clave plural y el singular legado sin duplicar', () => {
    const builder = queryBuilder();

    applyDashboardSchoolFilters(builder, {
      departments: ['Capital'],
      department: 'Capital',
      status: CampaignParticipationStatus.Draft,
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'school.department IN (:...departments)',
      { departments: ['Capital'] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'submission.status IN (:...submissionStatuses)',
      { submissionStatuses: [CampaignParticipationStatus.Draft] },
    );
  });
});

type QueryBuilderDouble = SelectQueryBuilder<CampaignSchool> & {
  andWhere: jest.Mock<unknown, [string, Record<string, unknown> | undefined]>;
};

function queryBuilder(): QueryBuilderDouble {
  return {
    andWhere: jest.fn(),
  } as unknown as QueryBuilderDouble;
}
