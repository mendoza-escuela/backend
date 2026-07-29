import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
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
  const dataSource = {
    getRepository: jest.fn((entity) => (entity === School ? repository : {})),
  } as unknown as DataSource;
  const create = jest.fn();
  const schoolsService = { create } as unknown as SchoolsService;
  const service = new BulkSchoolImportService(dataSource, schoolsService);

  beforeEach(() => jest.clearAllMocks());

  it('previews CSV rows and reports validation errors without saving', async () => {
    const csv = [
      headers(),
      validRow(),
      'X,,,1,,,,,,,,,,,,,,,,menos-uno,no-json,desconocido',
    ].join('\n');
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
    const csv = [
      headers(),
      validRow(),
      'X,,,1,,,,,,,,,,,,,,,,menos-uno,no-json,desconocido',
    ].join('\n');
    const result = await service.import(
      file('colegios.csv', Buffer.from(csv)),
      { id: 'actor-id' } as never,
    );
    expect(result).toMatchObject({ importedCount: 1, errorCount: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

const headers = () =>
  'cue,nombre,director,numero,departamento,localidad,direccion,codigo_postal,nivel,gestion,ambito,jornada,telefono,correo,referente_nombre,referente_apellido,referente_correo,referente_telefono,matricula,caracteristicas,estado';
const validRow = () =>
  '500012300,Escuela Uno,María González,1-001,Capital,Mendoza,San Martín 1,5500,Primario,Estatal,Urbano,Completa,2614000000,escuela@ejemplo.edu.ar,Ana,Pérez,ana@ejemplo.edu.ar,2614000001,350,{},activo';
function csvValues(line: string) {
  return line.split(',');
}
function file(originalname: string, buffer: Buffer): Express.Multer.File {
  return { originalname, buffer } as Express.Multer.File;
}
