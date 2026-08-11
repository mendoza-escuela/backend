import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { multiValueFilter } from '../../../common/transforms/multi-value-query.transform';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { School } from '../../schools/entities/school.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { OFFICIAL_SURVEY_DIMENSIONS } from '../../surveys/templates/official-survey-dimensions.template';
import {
  ParticipationDashboardQueryDto,
  ParticipationFilterOptionsQueryDto,
} from '../dto/participation-dashboard-query.dto';
import { applyDashboardSchoolFilters } from '../dashboard-query-filters';

type MetricRow = {
  totalSchools: string;
  notStarted: string;
  draft: string;
  submitted: string;
};

@Injectable()
export class ParticipationDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Calcula todos los indicadores desde las asignaciones vigentes.
   * La presentación es única por escuela y campaña, por lo que el LEFT JOIN no
   * multiplica filas ni requiere descargar registros al cliente.
   */
  async metrics(query: ParticipationDashboardQueryDto) {
    const campaign = await this.dataSource.getRepository(Campaign).findOneBy({
      id: query.campaignId,
    });
    if (!campaign) throw new NotFoundException('Campaña no encontrada.');
    if (campaign.status === CampaignStatus.Draft)
      throw new ConflictException(
        'Las campañas en borrador no poseen seguimiento de participación.',
      );

    const builder = this.dataSource
      .getRepository(CampaignSchool)
      .createQueryBuilder('assignment')
      .innerJoin(School, 'school', 'school.id = assignment.schoolId')
      .leftJoin(
        'survey_submissions',
        'submission',
        'submission.school_id = school.id AND submission.campaign_id = :campaignId',
        { campaignId: campaign.id },
      )
      .leftJoin(
        'evaluation_results',
        'evaluation',
        'evaluation.submission_id = submission.id AND submission.status = :submittedStatus',
      )
      .select('COUNT(school.id)', 'totalSchools')
      .addSelect(
        'COUNT(school.id) FILTER (WHERE submission.id IS NULL)',
        'notStarted',
      )
      .addSelect(
        'COUNT(school.id) FILTER (WHERE submission.status = :draftStatus)',
        'draft',
      )
      .addSelect(
        'COUNT(school.id) FILTER (WHERE submission.status = :submittedStatus)',
        'submitted',
      )
      .where('assignment.campaignId = :campaignId', {
        campaignId: campaign.id,
      })
      .andWhere('assignment.removedAt IS NULL')
      .setParameters({
        draftStatus: SubmissionStatus.Draft,
        submittedStatus: SubmissionStatus.Submitted,
      });

    applyDashboardSchoolFilters(builder, query);
    const row = await builder.getRawOne<MetricRow>();
    const totalSchools = Number(row?.totalSchools ?? 0);
    const submitted = Number(row?.submitted ?? 0);

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      },
      metrics: {
        totalSchools,
        notStarted: Number(row?.notStarted ?? 0),
        draft: Number(row?.draft ?? 0),
        submitted,
        participationPercentage:
          totalSchools === 0
            ? 0
            : Math.round((submitted / totalSchools) * 10_000) / 100,
      },
    };
  }

  /** Devuelve campañas consultables y opciones escolares dependientes. */
  async filterOptions(query: ParticipationFilterOptionsQueryDto) {
    const campaigns = await this.dataSource
      .getRepository(Campaign)
      .createQueryBuilder('campaign')
      .select([
        'campaign.id',
        'campaign.name',
        'campaign.status',
        'campaign.startsAt',
        'campaign.endsAt',
      ])
      .where('campaign.status != :draft', { draft: CampaignStatus.Draft })
      .orderBy(
        `CASE WHEN campaign.status = '${CampaignStatus.Active}' THEN 0 ELSE 1 END`,
        'ASC',
      )
      .addOrderBy('campaign.startsAt', 'DESC')
      .addOrderBy('campaign.name', 'ASC')
      .getMany();

    const defaultCampaignId =
      campaigns.find((campaign) => campaign.status === CampaignStatus.Active)
        ?.id ?? null;
    const selectedCampaignId =
      campaigns.find((campaign) => campaign.id === query.campaignId)?.id ??
      defaultCampaignId;
    if (!selectedCampaignId)
      return {
        campaigns: [],
        defaultCampaignId: null,
        departments: [],
        localities: [],
        educationLevels: [],
        educationLevelOptions: [],
        educationTypes: [],
        managementTypes: [],
        scopes: [],
        shifts: [],
        criticalAreas: OFFICIAL_SURVEY_DIMENSIONS.map(({ code, title }) => ({
          value: code,
          label: title,
        })),
        schools: [],
      };

    const departmentsFilter = multiValueFilter(
      query.departments,
      query.department,
    );
    const localitiesFilter = multiValueFilter(query.localities, query.locality);
    const schoolBuilder = this.dataSource
      .getRepository(CampaignSchool)
      .createQueryBuilder('assignment')
      .innerJoin(School, 'school', 'school.id = assignment.schoolId')
      .where('assignment.campaignId = :selectedCampaignId', {
        selectedCampaignId,
      })
      .andWhere('assignment.removedAt IS NULL');
    if (departmentsFilter.length)
      schoolBuilder.andWhere('school.department IN (:...departments)', {
        departments: departmentsFilter,
      });
    if (localitiesFilter.length)
      schoolBuilder.andWhere('school.locality IN (:...localities)', {
        localities: localitiesFilter,
      });

    const [
      departments,
      localities,
      educationLevelOptions,
      attributes,
      schools,
    ] = await Promise.all([
      this.distinct('department', selectedCampaignId),
      this.distinct('locality', selectedCampaignId, departmentsFilter),
      schoolBuilder
        .clone()
        .leftJoin(
          'school_education_levels',
          'school_level_option',
          'school_level_option.school_id = school.id',
        )
        .leftJoin(
          'education_level_catalogs',
          'education_level_option',
          'education_level_option.id = school_level_option.level_id',
        )
        .select('DISTINCT education_level_option.code', 'value')
        .addSelect('education_level_option.label', 'label')
        .andWhere('education_level_option.id IS NOT NULL')
        .orderBy('education_level_option.label', 'ASC')
        .addOrderBy('education_level_option.code', 'ASC')
        .getRawMany<{ value: string; label: string }>(),
      schoolBuilder
        .clone()
        .select('school.educationLevel', 'educationLevel')
        .addSelect('school.managementType', 'managementType')
        .addSelect('school.scope', 'scope')
        .addSelect('school.shift', 'shift')
        .getRawMany<
          Pick<School, 'educationLevel' | 'managementType' | 'scope' | 'shift'>
        >(),
      schoolBuilder
        .clone()
        .select('school.id', 'id')
        .addSelect('school.cue', 'cue')
        .addSelect('school.name', 'name')
        .orderBy('school.name', 'ASC')
        .addOrderBy('school.cue', 'ASC')
        .addOrderBy('school.id', 'ASC')
        .getRawMany<Pick<School, 'id' | 'cue' | 'name'>>(),
    ]);

    return {
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      })),
      defaultCampaignId,
      departments,
      localities,
      // Compatibilidad: esta clave histórica contenía Tipo de educación.
      educationLevels: this.values(attributes, 'educationLevel'),
      educationLevelOptions,
      educationTypes: this.values(attributes, 'educationLevel'),
      managementTypes: this.values(attributes, 'managementType'),
      scopes: this.values(attributes, 'scope'),
      shifts: this.values(attributes, 'shift'),
      criticalAreas: OFFICIAL_SURVEY_DIMENSIONS.map(({ code, title }) => ({
        value: code,
        label: title,
      })),
      schools: schools.map(({ id, cue, name }) => ({ id, cue, name })),
    };
  }

  private async distinct(
    field: 'department' | 'locality',
    campaignId: string,
    departments: string[] = [],
  ) {
    const column = field === 'department' ? 'department' : 'locality';
    const builder = this.dataSource
      .getRepository(CampaignSchool)
      .createQueryBuilder('assignment')
      .innerJoin(School, 'school', 'school.id = assignment.schoolId')
      .select(`DISTINCT school.${column}`, 'value')
      .where('assignment.campaignId = :campaignId', { campaignId })
      .andWhere('assignment.removedAt IS NULL')
      .andWhere(`school.${column} IS NOT NULL`)
      .andWhere(`TRIM(school.${column}) != ''`)
      .orderBy(`school.${column}`, 'ASC');
    if (departments.length && field === 'locality')
      builder.andWhere('school.department IN (:...departments)', {
        departments,
      });
    const rows = await builder.getRawMany<{ value: string }>();
    return rows.map(({ value }) => value);
  }

  private values(schools: Array<Partial<School>>, field: keyof School) {
    return [...new Set(schools.map((school) => school[field]))]
      .filter((value): value is string => typeof value === 'string' && !!value)
      .sort((left, right) => left.localeCompare(right, 'es'));
  }
}
