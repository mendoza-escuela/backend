import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CampaignParticipationStatus } from '../../campaigns/dto/list-campaign-tracking-query.dto';
import { AdminExportQueryDto } from '../../exports/dto/admin-export-query.dto';
import { OfficialSurveyDimensionCode } from '../../surveys/templates/official-survey-dimensions.template';
import {
  ParticipationDashboardQueryDto,
  ResultsComparisonDashboardQueryDto,
} from './participation-dashboard-query.dto';

const campaignId = '10000000-0000-4000-8000-000000000001';

describe('ParticipationDashboardQueryDto', () => {
  it('normaliza query repetida, elimina vacíos y duplicados', async () => {
    const query = plainToInstance(ParticipationDashboardQueryDto, {
      campaignId,
      departments: [' Capital ', 'Lavalle', 'Capital', ''],
      localities: ['Distrito 1, Sección A', 'Ciudad'],
      educationLevels: ['primario', ' secundario '],
      submissionStatuses: ['draft', 'submitted'],
      stars: ['1', '3', '5'],
      criticalAreas: ['salud_mental', 'actividad_fisica'],
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query.departments).toEqual(['Capital', 'Lavalle']);
    expect(query.localities).toEqual(['Distrito 1, Sección A', 'Ciudad']);
    expect(query.educationLevels).toEqual(['primario', 'secundario']);
    expect(query.submissionStatuses).toEqual([
      CampaignParticipationStatus.Draft,
      CampaignParticipationStatus.Submitted,
    ]);
    expect(query.stars).toEqual([1, 3, 5]);
    expect(query.criticalAreas).toEqual([
      OfficialSurveyDimensionCode.MentalHealth,
      OfficialSurveyDimensionCode.PhysicalActivity,
    ]);
  });

  it('conserva las claves singulares anteriores para compatibilidad', async () => {
    const query = plainToInstance(ParticipationDashboardQueryDto, {
      campaignId,
      schoolId: '20000000-0000-4000-8000-000000000001',
      department: ' Capital ',
      locality: 'Ciudad',
      educationLevel: 'Educación común',
      managementType: 'Estatal',
      scope: 'Urbano',
      shift: 'Simple',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query.department).toBe('Capital');
    expect(query.educationLevel).toBe('Educación común');
  });

  it('rechaza UUID, estados, estrellas y áreas fuera del contrato', async () => {
    const query = plainToInstance(ParticipationDashboardQueryDto, {
      campaignId,
      schoolIds: ['no-es-uuid'],
      submissionStatuses: ['started'],
      stars: ['0', '2.5', '6'],
      criticalAreas: ['dimension_inventada'],
    });
    const properties = (await validate(query)).map(({ property }) => property);

    expect(properties).toEqual(
      expect.arrayContaining([
        'schoolIds',
        'submissionStatuses',
        'stars',
        'criticalAreas',
      ]),
    );
  });

  it('limita la cantidad de parámetros de una categoría', async () => {
    const query = plainToInstance(ParticipationDashboardQueryDto, {
      campaignId,
      departments: Array.from(
        { length: 101 },
        (_, index) => `Departamento ${index}`,
      ),
    });

    expect((await validate(query)).map(({ property }) => property)).toContain(
      'departments',
    );
  });
});

describe('ResultsComparisonDashboardQueryDto', () => {
  const secondCampaignId = '10000000-0000-4000-8000-000000000002';

  it('acepta de dos a seis campañas y hereda los filtros DASH-04', async () => {
    const query = plainToInstance(ResultsComparisonDashboardQueryDto, {
      campaignIds: [campaignId, secondCampaignId],
      departments: [' Capital ', 'Lavalle'],
      schoolIds: '20000000-0000-4000-8000-000000000001',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query.campaignIds).toEqual([campaignId, secondCampaignId]);
    expect(query.departments).toEqual(['Capital', 'Lavalle']);
  });

  it('excluye filtros de outcome para no sesgar los períodos', async () => {
    const query = plainToInstance(ResultsComparisonDashboardQueryDto, {
      campaignIds: [campaignId, secondCampaignId],
      submissionStatuses: ['submitted'],
      stars: ['4'],
      criticalAreas: ['salud_mental'],
    });

    const errors = await validate(query, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['submissionStatuses', 'stars', 'criticalAreas']),
    );
  });

  it('rechaza campañas duplicadas en vez de normalizarlas silenciosamente', async () => {
    const query = plainToInstance(ResultsComparisonDashboardQueryDto, {
      campaignIds: [campaignId, secondCampaignId, campaignId],
    });

    expect((await validate(query)).map(({ property }) => property)).toContain(
      'campaignIds',
    );
  });

  it('rechaza menos de dos o más de seis campañas', async () => {
    const tooFew = plainToInstance(ResultsComparisonDashboardQueryDto, {
      campaignIds: [campaignId],
    });
    const tooMany = plainToInstance(ResultsComparisonDashboardQueryDto, {
      campaignIds: Array.from(
        { length: 7 },
        (_, index) =>
          `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      ),
    });

    expect((await validate(tooFew)).map(({ property }) => property)).toContain(
      'campaignIds',
    );
    expect((await validate(tooMany)).map(({ property }) => property)).toContain(
      'campaignIds',
    );
  });
});

describe('AdminExportQueryDto', () => {
  it('usa el mismo contrato plural y convierte un valor único de estrellas', async () => {
    const query = plainToInstance(AdminExportQueryDto, {
      campaignId,
      format: 'xlsx',
      departments: ['Capital', 'Lavalle'],
      submissionStatuses: ['not_started', 'submitted'],
      stars: '4',
      criticalAreas: 'salud_mental',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query.departments).toEqual(['Capital', 'Lavalle']);
    expect(query.submissionStatuses).toEqual([
      CampaignParticipationStatus.NotStarted,
      CampaignParticipationStatus.Submitted,
    ]);
    expect(query.stars).toEqual([4]);
  });
});
