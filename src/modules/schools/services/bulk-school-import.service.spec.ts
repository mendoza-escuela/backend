import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { EducationLevelCatalog } from '../entities/education-level-catalog.entity';
import { School } from '../entities/school.entity';
import { BulkSchoolImportService } from './bulk-school-import.service';
import { SchoolsService } from './schools.service';

describe('BulkSchoolImportService', () => {
  const getMany = jest.fn().mockResolvedValue([]);
  const repository = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      getMany,
    })),
  };
  const educationLevels = [
    {
      id: 'level-inicial',
      code: 'inicial',
      label: 'Inicial',
      isActive: true,
      order: 0,
    },
    {
      id: 'level-primario',
      code: 'primario',
      label: 'Primario',
      isActive: true,
      order: 1,
    },
  ] as EducationLevelCatalog[];
  const educationLevelRepository = {
    find: jest.fn().mockResolvedValue(educationLevels),
  };
  const dataSource = {
    getRepository: jest.fn((entity) =>
      entity === School ? repository : educationLevelRepository,
    ),
  } as unknown as DataSource;
  const create = jest.fn();
  const schoolsService = { create } as unknown as SchoolsService;
  const service = new BulkSchoolImportService(dataSource, schoolsService);

  beforeEach(() => jest.clearAllMocks());

  it('can parse and validate the exact downloaded template', async () => {
    const preview = await service.preview(
      file('plantilla-colegios.csv', service.template()),
    );

    expect(preview).toMatchObject({
      totalRows: 1,
      validCount: 1,
      errorCount: 0,
    });
  });

  it('previews CSV rows and reports validation errors without saving', async () => {
    const csv = [headers(), validRow(), invalidRow()].join('\n');
    const preview = await service.preview(
      file('colegios.csv', Buffer.from(csv)),
    );
    expect(preview).toMatchObject({
      totalRows: 2,
      validCount: 1,
      errorCount: 1,
    });
    expect(preview.rows[1].errors.length).toBeGreaterThan(5);
    expect(create).not.toHaveBeenCalled();
  });

  it('reads XLSX using the same columns', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Colegios');
    sheet.addRow(headers().split(','));
    sheet.addRow(csvValues(validRow()));
    const preview = await service.preview(
      file('colegios.xlsx', Buffer.from(await workbook.xlsx.writeBuffer())),
    );
    expect(preview).toMatchObject({
      totalRows: 1,
      validCount: 1,
      errorCount: 0,
    });
  });

  it('imports only valid rows', async () => {
    create.mockResolvedValue({ id: 'school-id', cue: '500012300' });
    const csv = [headers(), validRow(), invalidRow()].join('\n');
    const result = await service.import(
      file('colegios.csv', Buffer.from(csv)),
      { id: 'actor-id' } as never,
    );
    expect(result).toMatchObject({ importedCount: 1, errorCount: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        educationLevel: 'Educación común',
        educationLevels: [
          { levelId: 'level-inicial', enrollment: 45 },
          { levelId: 'level-primario', enrollment: 210 },
        ],
        enrollment: 255,
        characteristics: {
          isMultigrade: true,
          isInterculturalBilingual: false,
        },
      }),
      expect.anything(),
    );
  });

  it('mantiene vacía la matrícula total sin calcularla desde los niveles', async () => {
    create.mockResolvedValue({ id: 'school-id', cue: '500012300' });

    await service.import(
      file(
        'colegios.csv',
        Buffer.from([headers(), validRow({ matricula_total: '' })].join('\n')),
      ),
      { id: 'actor-id' } as never,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollment: null,
        educationLevels: [
          { levelId: 'level-inicial', enrollment: 45 },
          { levelId: 'level-primario', enrollment: 210 },
        ],
      }),
      expect.anything(),
    );
  });

  it('continúa aceptando la plantilla anterior con características JSON', async () => {
    const preview = await service.preview(
      file(
        'colegios-anterior.csv',
        Buffer.from([legacyHeaders(), legacyValidRow()].join('\n')),
      ),
    );

    expect(preview).toMatchObject({ validCount: 1, errorCount: 0 });
  });
});

const newHeaders = [
  'cue',
  'nombre',
  'director',
  'numero',
  'departamento',
  'localidad',
  'direccion',
  'codigo_postal',
  'tipo_educacion',
  'niveles_y_matriculas',
  'gestion',
  'ambito',
  'jornada',
  'telefono',
  'correo',
  'referente_nombre',
  'referente_apellido',
  'referente_cargo',
  'referente_correo',
  'referente_telefono',
  'matricula_total',
  'plurigrado',
  'intercultural_bilingue',
  'estado',
] as const;
const validValues: Record<(typeof newHeaders)[number], string> = {
  cue: '500012300',
  nombre: 'Escuela Uno',
  director: 'María González',
  numero: '1-001',
  departamento: 'Capital',
  localidad: 'Mendoza',
  direccion: 'San Martín 1',
  codigo_postal: '5500',
  tipo_educacion: 'Educación común',
  niveles_y_matriculas: 'Inicial: 45 | Primario: 210',
  gestion: 'Estatal',
  ambito: 'Urbano',
  jornada: 'Completa',
  telefono: '2614000000',
  correo: 'escuela@ejemplo.edu.ar',
  referente_nombre: 'Ana',
  referente_apellido: 'Pérez',
  referente_cargo: 'Secretaria',
  referente_correo: 'ana@ejemplo.edu.ar',
  referente_telefono: '2614000001',
  matricula_total: '255',
  plurigrado: 'si',
  intercultural_bilingue: 'no',
  estado: 'activo',
};
const headers = () => newHeaders.join(',');
const validRow = (overrides: Partial<typeof validValues> = {}) => {
  const values = { ...validValues, ...overrides };
  return newHeaders.map((header) => values[header]).join(',');
};
const invalidRow = () =>
  validRow({
    cue: 'X',
    nombre: '',
    director: '',
    departamento: '',
    localidad: '',
    direccion: '',
    tipo_educacion: '',
    niveles_y_matriculas: 'Desconocido: -1',
    gestion: '',
    ambito: '',
    jornada: '',
    referente_nombre: '',
    referente_apellido: '',
    referente_correo: '',
    matricula_total: 'menos-uno',
    plurigrado: 'quizás',
    estado: 'desconocido',
  });
const legacyHeaders = () =>
  'cue,nombre,director,numero,departamento,localidad,direccion,codigo_postal,nivel,gestion,ambito,jornada,telefono,correo,referente_nombre,referente_apellido,referente_correo,referente_telefono,matricula,caracteristicas,estado';
const legacyValidRow = () =>
  '500012301,Escuela Anterior,María González,1-002,Capital,Mendoza,San Martín 2,5500,Primario,Estatal,Urbano,Completa,2614000000,anterior@ejemplo.edu.ar,Ana,Pérez,ana.anterior@ejemplo.edu.ar,2614000001,350,{},activo';
function csvValues(line: string) {
  return line.split(',');
}
function file(originalname: string, buffer: Buffer): Express.Multer.File {
  return { originalname, buffer } as Express.Multer.File;
}
