import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { School } from '../../schools/entities/school.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import {
  ParticipationDashboardQueryDto,
  ParticipationFilterOptionsQueryDto,
} from '../dto/participation-dashboard-query.dto';

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
   * Calcula todos los indicadores desde el mismo conjunto de escuelas activas.
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
      .getRepository(School)
      .createQueryBuilder('school')
      .leftJoin(
        'survey_submissions',
        'submission',
        'submission.school_id = school.id AND submission.campaign_id = :campaignId',
        { campaignId: campaign.id },
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
      .where('school.is_active = true')
      .setParameters({
        draftStatus: SubmissionStatus.Draft,
        submittedStatus: SubmissionStatus.Submitted,
      });

    this.applyFilters(builder, query);
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

    const schoolBuilder = this.dataSource
      .getRepository(School)
      .createQueryBuilder('school')
      .where('school.is_active = true');
    if (query.department)
      schoolBuilder.andWhere('school.department = :department', {
        department: query.department,
      });
    if (query.locality)
      schoolBuilder.andWhere('school.locality = :locality', {
        locality: query.locality,
      });

    const [departments, localities, attributes, schools] = await Promise.all([
      this.distinct('department'),
      this.distinct('locality', query.department),
      schoolBuilder
        .clone()
        .select([
          'school.educationLevel',
          'school.managementType',
          'school.scope',
          'school.shift',
        ])
        .getMany(),
      schoolBuilder
        .clone()
        .select(['school.id', 'school.cue', 'school.name'])
        .orderBy('school.name', 'ASC')
        .addOrderBy('school.cue', 'ASC')
        .getMany(),
    ]);

    return {
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      })),
      defaultCampaignId:
        campaigns.find((campaign) => campaign.status === CampaignStatus.Active)
          ?.id ?? null,
      departments,
      localities,
      educationLevels: this.values(attributes, 'educationLevel'),
      managementTypes: this.values(attributes, 'managementType'),
      scopes: this.values(attributes, 'scope'),
      shifts: this.values(attributes, 'shift'),
      schools: schools.map(({ id, cue, name }) => ({ id, cue, name })),
    };
  }

  private applyFilters(
    builder: SelectQueryBuilder<School>,
    query: ParticipationDashboardQueryDto,
  ) {
    const filters: Array<[keyof ParticipationDashboardQueryDto, string]> = [
      ['schoolId', 'school.id'],
      ['department', 'school.department'],
      ['locality', 'school.locality'],
      ['educationLevel', 'school.education_level'],
      ['managementType', 'school.management_type'],
      ['scope', 'school.scope'],
      ['shift', 'school.shift'],
    ];
    for (const [property, column] of filters) {
      const value = query[property];
      if (value)
        builder.andWhere(`${column} = :${property}`, { [property]: value });
    }
  }

  private async distinct(
    field: 'department' | 'locality',
    department?: string,
  ) {
    const column = field === 'department' ? 'department' : 'locality';
    const builder = this.dataSource
      .getRepository(School)
      .createQueryBuilder('school')
      .select(`DISTINCT school.${column}`, 'value')
      .where('school.is_active = true')
      .andWhere(`school.${column} IS NOT NULL`)
      .andWhere(`TRIM(school.${column}) != ''`)
      .orderBy(`school.${column}`, 'ASC');
    if (department && field === 'locality')
      builder.andWhere('school.department = :department', { department });
    const rows = await builder.getRawMany<{ value: string }>();
    return rows.map(({ value }) => value);
  }

  private values(schools: School[], field: keyof School) {
    return [...new Set(schools.map((school) => school[field]))]
      .filter((value): value is string => typeof value === 'string' && !!value)
      .sort((left, right) => left.localeCompare(right, 'es'));
  }
}
