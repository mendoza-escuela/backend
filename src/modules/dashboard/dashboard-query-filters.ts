import { SelectQueryBuilder } from 'typeorm';
import { multiValueFilter } from '../../common/transforms/multi-value-query.transform';
import { CampaignParticipationStatus } from '../campaigns/dto/list-campaign-tracking-query.dto';
import { CampaignSchool } from '../campaigns/entities/campaign-school.entity';

export type DashboardSchoolFilterQuery = {
  schoolIds?: string[];
  schoolId?: string;
  departments?: string[];
  department?: string;
  localities?: string[];
  locality?: string;
  educationLevels?: string[];
  educationTypes?: string[];
  educationLevel?: string;
  managementTypes?: string[];
  managementType?: string;
  scopes?: string[];
  scope?: string;
  shifts?: string[];
  shift?: string;
  submissionStatuses?: CampaignParticipationStatus[];
  status?: CampaignParticipationStatus;
  stars?: number[] | number;
  criticalAreas?: string[];
  criticalArea?: string;
};

/**
 * Aplica los filtros compartidos por dashboard y exportaciones.
 *
 * Cada categoría usa OR (`IN`) y las categorías se combinan mediante AND. El
 * nivel se resuelve contra la relación estructurada y su código de catálogo;
 * `schools.education_level` se conserva como Tipo de educación.
 */
export function applyDashboardSchoolFilters(
  builder: SelectQueryBuilder<CampaignSchool>,
  query: DashboardSchoolFilterQuery,
): void {
  const filters: Array<{
    values: string[];
    column: string;
    parameter: string;
  }> = [
    {
      values: multiValueFilter(query.schoolIds, query.schoolId),
      column: 'school.id',
      parameter: 'schoolIds',
    },
    {
      values: multiValueFilter(query.departments, query.department),
      column: 'school.department',
      parameter: 'departments',
    },
    {
      values: multiValueFilter(query.localities, query.locality),
      column: 'school.locality',
      parameter: 'localities',
    },
    {
      values: multiValueFilter(query.educationTypes, query.educationLevel),
      column: 'school.education_level',
      parameter: 'educationTypes',
    },
    {
      values: multiValueFilter(query.managementTypes, query.managementType),
      column: 'school.management_type',
      parameter: 'managementTypes',
    },
    {
      values: multiValueFilter(query.scopes, query.scope),
      column: 'school.scope',
      parameter: 'scopes',
    },
    {
      values: multiValueFilter(query.shifts, query.shift),
      column: 'school.shift',
      parameter: 'shifts',
    },
  ];

  for (const { values, column, parameter } of filters) {
    if (!values.length) continue;
    builder.andWhere(`${column} IN (:...${parameter})`, {
      [parameter]: values,
    });
  }

  if (query.educationLevels?.length)
    builder.andWhere(
      `EXISTS (
        SELECT 1
        FROM school_education_levels dashboard_school_level
        INNER JOIN education_level_catalogs dashboard_education_level
          ON dashboard_education_level.id = dashboard_school_level.level_id
        WHERE dashboard_school_level.school_id = school.id
          AND dashboard_education_level.code IN (:...educationLevels)
      )`,
      { educationLevels: query.educationLevels },
    );

  const stars = Array.isArray(query.stars)
    ? query.stars
    : query.stars
      ? [query.stars]
      : [];
  if (stars.length)
    builder.andWhere('evaluation.stars IN (:...stars)', { stars });

  const criticalAreas = multiValueFilter(
    query.criticalAreas,
    query.criticalArea,
  );
  if (criticalAreas.length)
    builder.andWhere(
      `EXISTS (
        SELECT 1
        FROM evaluation_dimension_results dashboard_critical_dimension
        WHERE dashboard_critical_dimension.result_id = evaluation.id
          AND dashboard_critical_dimension.dimension_code IN (:...criticalAreas)
          AND dashboard_critical_dimension.is_critical = true
      )`,
      { criticalAreas },
    );

  applySubmissionStatuses(builder, query);
}

function applySubmissionStatuses(
  builder: SelectQueryBuilder<CampaignSchool>,
  query: DashboardSchoolFilterQuery,
) {
  const statuses = multiValueFilter(
    query.submissionStatuses,
    query.status,
  ) as CampaignParticipationStatus[];
  if (!statuses.length || statuses.length === 3) return;

  const includesNotStarted = statuses.includes(
    CampaignParticipationStatus.NotStarted,
  );
  const persistedStatuses = statuses.filter(
    (status) => status !== CampaignParticipationStatus.NotStarted,
  );

  if (includesNotStarted && persistedStatuses.length) {
    builder.andWhere(
      '(submission.id IS NULL OR submission.status IN (:...submissionStatuses))',
      { submissionStatuses: persistedStatuses },
    );
    return;
  }
  if (includesNotStarted) {
    builder.andWhere('submission.id IS NULL');
    return;
  }
  builder.andWhere('submission.status IN (:...submissionStatuses)', {
    submissionStatuses: persistedStatuses,
  });
}
