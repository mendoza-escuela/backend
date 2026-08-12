import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SchoolContactType } from '../entities/school-contact.entity';
import { RectifySchoolDto } from './rectify-school.dto';

const shiftCatalogId = '8bbdded8-8980-4a27-a1dc-95d39362f510';
const levelId = 'c6a0ca01-6db2-44a0-a841-9426c33ee88c';
const base = {
  name: 'Escuela Uno',
  cue: '500012300',
  directorName: 'Ana Pérez',
  department: 'Capital',
  address: 'San Martín 100',
  locality: 'Mendoza',
  scope: 'Urbano',
  educationLevel: 'Educación común',
  managementType: 'Estatal',
  hasKiosk: false,
  hasFoodService: true,
  shiftCatalogId,
  educationLevels: [{ levelId, enrollment: null }],
  expectedUpdatedAt: '2026-07-29T12:00:00.000Z',
};

describe('RectifySchoolDto', () => {
  it('acepta la ficha completa y valida los datos opcionales informados', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      isBoarding: false,
      characteristics: {
        isMultigrade: true,
        isInterculturalBilingual: false,
      },
      contacts: [
        {
          type: SchoolContactType.Respondent,
          firstName: 'Ana',
          lastName: 'Pérez',
          position: 'Directora',
          phone: '2615551111',
          email: 'ana@example.edu.ar',
        },
        {
          type: SchoolContactType.HealthPromotion,
          firstName: 'Laura',
          lastName: 'Gómez',
          position: 'Referente',
          phone: '2615552222',
          email: 'laura@example.edu.ar',
        },
      ],
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('exige jornada, al menos un nivel y banderas de aplicabilidad conocidas', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      shiftCatalogId: null,
      educationLevels: [],
      hasKiosk: null,
      hasFoodService: null,
    });

    const errors = await validate(dto);

    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining([
        'shiftCatalogId',
        'educationLevels',
        'hasKiosk',
        'hasFoodService',
      ]),
    );
  });

  it('preserva false y null sin confundirlos con datos ausentes', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      hasKiosk: false,
      hasFoodService: false,
      isBoarding: null,
      enrollment: 0,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      hasKiosk: false,
      hasFoodService: false,
      isBoarding: null,
      enrollment: 0,
    });
  });

  it('acepta null explícito para limpiar características oficiales', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      characteristics: {
        isMultigrade: null,
        isInterculturalBilingual: null,
      },
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.characteristics).toEqual({
      isMultigrade: null,
      isInterculturalBilingual: null,
    });
  });

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
      educationLevels: [{ levelId, enrollment: null }],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.enrollment).toBeNull();
    expect(dto.educationLevels[0].enrollment).toBeNull();
  });

  it('no transforma campos numéricos vacíos en cero', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      enrollment: '',
      educationLevels: [{ levelId, enrollment: '' }],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.enrollment).toBeNull();
    expect(dto.educationLevels[0].enrollment).toBeNull();
  });

  it('rechaza identificadores y etiquetas fuera de los catálogos oficiales', async () => {
    const dto = plainToInstance(RectifySchoolDto, {
      ...base,
      scope: 'Metropolitano',
      educationLevel: 'Universitario',
      managementType: 'Mixto',
      shiftCatalogId: 'jornada-visible',
      educationLevels: [{ levelId: 'primario', enrollment: 20 }],
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
