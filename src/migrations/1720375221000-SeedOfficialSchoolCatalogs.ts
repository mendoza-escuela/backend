import { MigrationInterface, QueryRunner } from 'typeorm';

const OFFICIAL_SHIFTS = [
  {
    id: '6a010001-0000-4000-8000-000000000001',
    code: 'simple',
    label: 'Simple',
  },
  {
    id: '6a010001-0000-4000-8000-000000000002',
    code: 'extendida',
    label: 'Extendida',
  },
  {
    id: '6a010001-0000-4000-8000-000000000003',
    code: 'completa_frontera',
    label: 'Completa frontera',
  },
  {
    id: '6a010001-0000-4000-8000-000000000004',
    code: 'completa_albergue',
    label: 'Completa albergue',
  },
  {
    id: '6a010001-0000-4000-8000-000000000005',
    code: 'ampliacion_primaria_convenio_nacion',
    label: 'Ampliación primaria (convenio Nación)',
  },
  {
    id: '6a010001-0000-4000-8000-000000000006',
    code: 'fortalecimiento_trayectorias',
    label: 'Fortalecimiento de trayectorias',
  },
] as const;

const OFFICIAL_EDUCATION_LEVELS = [
  {
    id: '6a020001-0000-4000-8000-000000000001',
    code: 'inicial',
    label: 'Inicial',
  },
  {
    id: '6a020001-0000-4000-8000-000000000002',
    code: 'primario',
    label: 'Primario',
  },
  {
    id: '6a020001-0000-4000-8000-000000000003',
    code: 'secundario',
    label: 'Secundario',
  },
  {
    id: '6a020001-0000-4000-8000-000000000004',
    code: 'superior',
    label: 'Superior',
  },
] as const;

const normalized = (value: string) => `LOWER(REGEXP_REPLACE(TRANSLATE(
  BTRIM(COALESCE(${value}, '')),
  'ÁÉÍÓÚÜÑáéíóúüñ',
  'AEIOUUNaeiouun'
), '\\s+', ' ', 'g'))`;

export class SeedOfficialSchoolCatalogs1720375221000 implements MigrationInterface {
  name = 'SeedOfficialSchoolCatalogs1720375221000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [order, shift] of OFFICIAL_SHIFTS.entries())
      await queryRunner.query(
        `INSERT INTO "school_shift_catalogs"
          ("id", "code", "label", "is_active", "order")
         VALUES ($1::uuid, $2, $3, true, $4)
         ON CONFLICT ("code") DO UPDATE SET
          "label" = EXCLUDED."label",
          "is_active" = true,
          "order" = EXCLUDED."order",
          "updated_at" = now()`,
        [shift.id, shift.code, shift.label, order],
      );

    for (const [order, level] of OFFICIAL_EDUCATION_LEVELS.entries())
      await queryRunner.query(
        `INSERT INTO "education_level_catalogs"
          ("id", "code", "label", "is_active", "order")
         VALUES ($1::uuid, $2, $3, true, $4)
         ON CONFLICT ("code") DO UPDATE SET
          "label" = EXCLUDED."label",
          "is_active" = true,
          "order" = EXCLUDED."order",
          "updated_at" = now()`,
        [level.id, level.code, level.label, order],
      );

    await queryRunner.query(
      `WITH "official" AS (
         SELECT "id", ${normalized('"label"')} AS "normalized_label"
         FROM "school_shift_catalogs"
         WHERE "code" = ANY($1::varchar[])
       ), "unambiguous" AS (
         SELECT MIN("id"::text)::uuid AS "id", "normalized_label"
         FROM "official"
         GROUP BY "normalized_label"
         HAVING COUNT(*) = 1
       )
       UPDATE "schools" AS "school"
       SET "shift_catalog_id" = "catalog"."id"
       FROM "unambiguous" AS "catalog"
       WHERE "school"."shift_catalog_id" IS NULL
         AND ${normalized('"school"."shift"')} = "catalog"."normalized_label"`,
      [OFFICIAL_SHIFTS.map(({ code }) => code)],
    );

    await queryRunner.query(
      `WITH "official" AS (
         SELECT "id", ${normalized('"label"')} AS "normalized_label"
         FROM "education_level_catalogs"
         WHERE "code" = ANY($1::varchar[])
       ), "unambiguous" AS (
         SELECT MIN("id"::text)::uuid AS "id", "normalized_label"
         FROM "official"
         GROUP BY "normalized_label"
         HAVING COUNT(*) = 1
       )
       INSERT INTO "school_education_levels"
         ("school_id", "level_id", "enrollment", "order")
       SELECT "school"."id", "catalog"."id", NULL, 0
       FROM "schools" AS "school"
       INNER JOIN "unambiguous" AS "catalog"
         ON ${normalized('"school"."education_level"')} = "catalog"."normalized_label"
       WHERE NOT EXISTS (
         SELECT 1 FROM "school_education_levels" AS "current"
         WHERE "current"."school_id" = "school"."id"
       )
       ON CONFLICT DO NOTHING`,
      [OFFICIAL_EDUCATION_LEVELS.map(({ code }) => code)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "school_shift_catalogs" AS "catalog"
       WHERE "catalog"."id" = ANY($1::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM "schools" AS "school"
           WHERE "school"."shift_catalog_id" = "catalog"."id"
         )`,
      [OFFICIAL_SHIFTS.map(({ id }) => id)],
    );
    await queryRunner.query(
      `DELETE FROM "education_level_catalogs" AS "catalog"
       WHERE "catalog"."id" = ANY($1::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM "school_education_levels" AS "current"
           WHERE "current"."level_id" = "catalog"."id"
         )
         AND NOT EXISTS (
           SELECT 1 FROM "school_rectification_education_levels" AS "history"
           WHERE "history"."level_id" = "catalog"."id"
         )`,
      [OFFICIAL_EDUCATION_LEVELS.map(({ id }) => id)],
    );
  }
}
