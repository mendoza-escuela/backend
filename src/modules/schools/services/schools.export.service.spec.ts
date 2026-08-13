import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { EducationLevelCatalog } from '../entities/education-level-catalog.entity';
import { SchoolEducationLevel } from '../entities/school-education-level.entity';
import { SchoolRectification } from '../entities/school-rectification.entity';
import { SchoolContact } from '../entities/school-contact.entity';
import { School } from '../entities/school.entity';
import { SchoolsService } from './schools.service';

describe('SchoolsService registry export', () => {
  const school = {
    id: 'school-id',
    cue: '500012300',
    name: 'Escuela Uno',
    directorName: 'María González',
    schoolNumber: '1-001',
    department: 'Capital',
    locality: 'Mendoza',
    address: 'San Martín 1',
    postalCode: '5500',
    educationLevel: 'Educación común',
    managementType: 'Estatal',
    scope: 'Urbano',
    shift: 'Completa',
    email: 'escuela@ejemplo.edu.ar',
    phone: '2614000000',
    referentFirstName: 'Ana',
    referentLastName: 'Pérez',
    referentEmail: 'ana@ejemplo.edu.ar',
    referentPhone: '2614000001',
    enrollment: null,
    isActive: true,
  } as School;
  const schoolBuilder = {
    orderBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([school]),
  };
  const rectificationBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([
      {
        schoolId: school.id,
        rectifiedAt: new Date('2026-08-12T18:35:42.000Z'),
      },
    ]),
  };
  const level = (
    id: string,
    label: string,
    enrollment: number | null,
    order: number,
  ) =>
    ({
      schoolId: school.id,
      levelId: id,
      enrollment,
      order,
      level: { id, code: label.toLowerCase(), label } as EducationLevelCatalog,
    }) as SchoolEducationLevel;
  const repositories = new Map<unknown, unknown>([
    [School, { createQueryBuilder: jest.fn(() => schoolBuilder) }],
    [SchoolContact, { find: jest.fn().mockResolvedValue([]) }],
    [
      SchoolEducationLevel,
      {
        find: jest
          .fn()
          .mockResolvedValue([
            level('inicial-id', 'Inicial', 45, 0),
            level('primario-id', 'Primario', null, 1),
          ]),
      },
    ],
    [
      SchoolRectification,
      { createQueryBuilder: jest.fn(() => rectificationBuilder) },
    ],
    [AuditLog, { save: jest.fn().mockResolvedValue(undefined) }],
  ]);
  const dataSource = {
    getRepository: jest.fn((entity) => repositories.get(entity)),
  } as unknown as DataSource;
  const service = new SchoolsService(dataSource);
  const query = { page: 1, limit: 20 };
  const actor = { id: 'actor-id' } as never;

  it('exporta niveles, matrículas y fecha local en CSV sin calcular el total', async () => {
    const exported = await service.export(query, 'csv', actor);
    const content = exported.buffer.toString('utf8');

    expect(content).toContain(
      'Tipo de educación,Niveles educativos,Matrícula por nivel',
    );
    expect(content).toContain(
      'Educación común,Inicial | Primario,Inicial: 45 | Primario: Sin informar',
    );
    expect(content).toContain(',Matrícula total,Estado,');
    expect(content).toContain(',12/08/2026 15:35:42');
  });

  it('mantiene las mismas columnas y valores en XLSX', async () => {
    const exported = await service.export(query, 'xlsx', actor);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Padrón');

    expect(sheet?.getCell('I1').text).toBe('Tipo de educación');
    expect(sheet?.getCell('J2').text).toBe('Inicial | Primario');
    expect(sheet?.getCell('K2').text).toBe(
      'Inicial: 45 | Primario: Sin informar',
    );
    expect(sheet?.getCell('U1').text).toBe('Matrícula total');
    expect(sheet?.getCell('U2').text).toBe('');
    expect(sheet?.getCell('Y2').text).toBe('12/08/2026 15:35:42');
  });
});
