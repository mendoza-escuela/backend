import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SchoolFieldsDto } from './school-fields.dto';

const base = {
  cue: '500012300',
  name: 'Escuela Uno',
  directorName: 'Ana Pérez',
  department: 'Capital',
  locality: 'Mendoza',
  address: 'San Martín 100',
  educationLevel: 'Educación común',
  managementType: 'Estatal',
  scope: 'Urbano',
  shift: 'Simple',
  referentFirstName: 'Ana',
  referentLastName: 'Pérez',
  enrollment: 100,
};

describe('SchoolFieldsDto', () => {
  it('acepta catálogos oficiales y campos estructurados opcionales', async () => {
    const dto = plainToInstance(SchoolFieldsDto, {
      ...base,
      shiftCatalogId: '8bbdded8-8980-4a27-a1dc-95d39362f510',
      educationLevels: [
        {
          levelId: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
          enrollment: 100,
        },
      ],
      hasKiosk: false,
      hasFoodService: true,
      isBoarding: false,
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza tipo de educación, sector y ámbito no oficiales', async () => {
    const dto = plainToInstance(SchoolFieldsDto, {
      ...base,
      educationLevel: 'Universitario',
      managementType: 'Mixto',
      scope: 'Metropolitano',
    });

    expect((await validate(dto)).map(({ property }) => property)).toEqual(
      expect.arrayContaining(['educationLevel', 'managementType', 'scope']),
    );
  });

  it.each([
    ['omitida', undefined],
    ['nula', null],
    ['vacía', ''],
  ])(
    'acepta matrícula %s y conserva la semántica de dato desconocido',
    async (_case, enrollment) => {
      const withoutEnrollment = Object.fromEntries(
        Object.entries(base).filter(([key]) => key !== 'enrollment'),
      );
      const dto = plainToInstance(SchoolFieldsDto, {
        ...withoutEnrollment,
        ...(enrollment !== undefined ? { enrollment } : {}),
      });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.enrollment ?? null).toBeNull();
    },
  );

  it.each([-1, 1.5, 1_000_001])(
    'rechaza matrícula inválida: %s',
    async (enrollment) => {
      const dto = plainToInstance(SchoolFieldsDto, { ...base, enrollment });
      expect((await validate(dto)).map(({ property }) => property)).toContain(
        'enrollment',
      );
    },
  );
});
