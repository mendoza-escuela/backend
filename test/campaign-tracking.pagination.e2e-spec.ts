import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CampaignParticipationStatus,
  CampaignTrackingSort,
  ListCampaignTrackingQueryDto,
  SortDirection,
} from '../src/modules/campaigns/dto/list-campaign-tracking-query.dto';
import { CampaignTrackingService } from '../src/modules/campaigns/services/campaign-tracking.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Campaign tracking pagination (PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: CampaignTrackingService;
  let campaignId: string;
  const runMarker = randomUUID().slice(0, 8);
  const performanceSamples: Array<{
    scenario: string;
    elapsedMs: number;
    payloadBytes: number;
  }> = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      entities: [__dirname + '/../src/modules/**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();
    service = new CampaignTrackingService(dataSource);

    const [{ id: surveyId }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO surveys (code, name)
       VALUES ($1, 'Cuestionario para prueba de seguimiento')
       RETURNING id`,
      [`TRACKING-PERF-${runMarker}`],
    );
    const [{ id: surveyVersionId }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO survey_versions
         (survey_id, version_number, title, status, published_at)
       VALUES ($1, 1, 'Versión de prueba', 'published', now())
       RETURNING id`,
      [surveyId],
    );
    [{ id: campaignId }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO campaigns
         (name, type, status, survey_version_id, starts_at, ends_at, activated_at)
       VALUES
         ('Campaña de paginación', 'annual', 'active', $1,
          now() - interval '1 day', now() + interval '30 days', now())
       RETURNING id`,
      [surveyVersionId],
    );

    await dataSource.query(
      `INSERT INTO schools (
         cue, name, school_number, department, locality, address,
         education_level, management_type, scope, shift,
         referent_first_name, referent_last_name, director_name
       )
       SELECT
         $1 || lpad(series::text, 5, '0'),
         'Escuela ' || lpad(series::text, 5, '0'),
         $2 || series,
         CASE WHEN series % 2 = 0 THEN 'Capital' ELSE 'Godoy Cruz' END,
         'Localidad de prueba', 'Calle de prueba 1', 'Primario',
         'Estatal', 'Urbano', 'Mañana', 'Ana', 'Pérez', 'Dirección de prueba'
       FROM generate_series(1, 2500) AS series`,
      [`PERF-${runMarker}-`, `TRACKING-${runMarker}-`],
    );
    await dataSource.query(
      `INSERT INTO campaign_schools
         (campaign_id, school_id, assignment_source, assigned_at)
       SELECT $1, id, 'bulk', now()
       FROM schools
       WHERE school_number LIKE $2`,
      [campaignId, `TRACKING-${runMarker}-%`],
    );
    await dataSource.query(
      `INSERT INTO survey_submissions (
         campaign_id, school_id, survey_version_id,
         original_respondent_snapshot, status, started_at, last_saved_at,
         submitted_at, school_profile_snapshot
       )
       SELECT
         $1, id, $2,
         '{"firstName":"Ana","lastName":"Pérez","email":"ana@example.com"}'::jsonb,
         CASE WHEN split_part(school_number, '-', 3)::integer <= 1666
           THEN 'draft'::survey_submissions_status_enum
           ELSE 'submitted'::survey_submissions_status_enum
         END,
         now() - interval '2 hours', now() - interval '1 hour',
         CASE WHEN split_part(school_number, '-', 3)::integer > 1666
           THEN now() ELSE NULL END,
         '{}'::jsonb
       FROM schools
       WHERE school_number LIKE $3
         AND split_part(school_number, '-', 3)::integer > 833`,
      [campaignId, surveyVersionId, `TRACKING-${runMarker}-%`],
    );
  }, 60_000);

  afterAll(async () => {
    if (process.env.TRACKING_PERF_LOG === 'true') {
      process.stdout.write(
        `TRACKING_PERFORMANCE=${JSON.stringify(performanceSamples)}\n`,
      );
    }
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('returns disjoint stable pages and never exceeds the requested limit', async () => {
    const first = await timedList({ page: 1, limit: 20 });
    const second = await timedList({ page: 2, limit: 20 });

    expect(first.response.pagination.total).toBe(2500);
    expect(first.response.items).toHaveLength(20);
    expect(second.response.items).toHaveLength(20);
    expect(
      new Set(first.response.items.map(({ school }) => school.id)).size,
    ).toBe(20);
    const firstIds = new Set(
      first.response.items.map(({ school }) => school.id),
    );
    expect(
      second.response.items.every(({ school }) => !firstIds.has(school.id)),
    ).toBe(true);
    expect(first.response.items.map(({ school }) => school.name)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `Escuela ${String(index + 1).padStart(5, '0')}`,
      ),
    );
    expect(Buffer.byteLength(JSON.stringify(first.response))).toBeLessThan(
      100_000,
    );
    expect(first.elapsedMs).toBeLessThan(5_000);
    expect(second.elapsedMs).toBeLessThan(5_000);
  });

  it('keeps name, CUE and ID as deterministic descending keys', async () => {
    const { response } = await timedList({
      page: 1,
      limit: 20,
      sortBy: CampaignTrackingSort.School,
      sortDirection: SortDirection.Desc,
    });

    expect(response.items[0].school.name).toBe('Escuela 02500');
    expect(response.items[19].school.name).toBe('Escuela 02481');
  });

  it('searches by CUE without expanding the page payload', async () => {
    const { response } = await timedList({
      page: 1,
      limit: 20,
      search: `PERF-${runMarker}-01234`,
    });

    expect(response.pagination.total).toBe(1);
    expect(response.items).toHaveLength(1);
    expect(response.items[0].school.cue).toBe(`PERF-${runMarker}-01234`);
  });

  it.each([
    [CampaignParticipationStatus.NotStarted, 833],
    [CampaignParticipationStatus.Draft, 833],
    [CampaignParticipationStatus.Submitted, 834],
  ])('filters %s in PostgreSQL', async (status, total) => {
    const { response } = await timedList({ page: 1, limit: 20, status });

    expect(response.pagination.total).toBe(total);
    expect(response.items).toHaveLength(20);
    expect(response.items.every((school) => school.status === status)).toBe(
      true,
    );
  });

  async function timedList(values: Partial<ListCampaignTrackingQueryDto>) {
    const query = Object.assign(new ListCampaignTrackingQueryDto(), values);
    const startedAt = performance.now();
    const response = await service.list(campaignId, query);
    const elapsedMs = performance.now() - startedAt;
    performanceSamples.push({
      scenario: values.search
        ? 'search'
        : values.status
          ? `status:${values.status}`
          : values.sortDirection === SortDirection.Desc
            ? 'school:desc'
            : `page:${values.page ?? 1}`,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      payloadBytes: Buffer.byteLength(JSON.stringify(response)),
    });
    return { response, elapsedMs };
  }
});
