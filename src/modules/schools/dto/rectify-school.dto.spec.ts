import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RectifySchoolDto } from './rectify-school.dto';

const base = {
  name: 'Escuela Uno',
  cue: '500012300',
  directorName: 'Ana Pérez',
  address: 'San Martín 100',
  locality: 'Mendoza',
  scope: 'Urbano',
  expectedUpdatedAt: '2026-07-29T12:00:00.000Z',
};

describe('RectifySchoolDto', () => {
  it.each([
    [true, true, true],
    [false, false, false],
    [null, null, null],
  ])(
    'preserva la semántica ternaria de las características',
    async (hasKiosk, hasFoodService, isBoarding) => {
      const dto = plainToInstance(RectifySchoolDto, {
        ...base,
        hasKiosk,
        hasFoodService,
        isBoarding,
        enrollment: 0,
        shiftCatalogId: null,
        educationLevels: [],
      });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toMatchObject({
        hasKiosk,
        hasFoodService,
        isBoarding,
        enrollment: 0,
      });
    },
  );

  it.each([-1, 1.5, 1_000_001])(
    'rechaza matrícula total inválida: %s',
    async (enrollment) => {
      const dto = plainToInstance(RectifySchoolDto, {
        ...base,
        enrollment,
      });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it('acepta matrícula total y por nivel sin informar sin convertirlas a cero', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      enrollment: null,
      educationLevels: [
        {
          levelId: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
          enrollment: null,
        },
      ],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.enrollment).toBeNull();
    expect(dto.educationLevels?.[0].enrollment).toBeNull();
  });

  it('no transforma campos numéricos vacíos en cero', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      enrollment: '',
      educationLevels: [
        {
          levelId: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
          enrollment: '',
        },
      ],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.enrollment).toBeNull();
    expect(dto.educationLevels?.[0].enrollment).toBeNull();
  });

  it('rechaza identificadores de catálogo inválidos', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      shiftCatalogId: 'jornada-visible',
      educationLevels: [{ levelId: 'primario', enrollment: 20 }],
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
