import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminRectifySchoolDto } from './admin-rectify-school.dto';

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
  shiftCatalogId: '8bbdded8-8980-4a27-a1dc-95d39362f510',
  educationLevels: [
    {
      levelId: 'c6a0ca01-6db2-44a0-a841-9426c33ee88c',
      enrollment: null,
    },
  ],
};

describe('AdminRectifySchoolDto', () => {
  it('acepta, normaliza y permite limpiar los campos administrativos', async () => {
    const dto = plainToInstance(AdminRectifySchoolDto, {
      ...base,
      schoolNumber: '  1-001  ',
      postalCode: null,
      phone: '  261 555 0000  ',
      email: '  ESCUELA@EXAMPLE.EDU.AR  ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      schoolNumber: '1-001',
      postalCode: null,
      phone: '261 555 0000',
      email: 'escuela@example.edu.ar',
    });
  });

  it('rechaza formatos inválidos y no incorpora el estado de la escuela', async () => {
    const dto = plainToInstance(AdminRectifySchoolDto, {
      ...base,
      schoolNumber: 'X'.repeat(31),
      postalCode: 'X'.repeat(21),
      phone: 'X'.repeat(41),
      email: 'correo-inválido',
      isActive: false,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining([
        'schoolNumber',
        'postalCode',
        'phone',
        'email',
        'isActive',
      ]),
    );
  });
});
