import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { AdminUsersService } from './admin-users.service';
import { BulkUserImportService } from './bulk-user-import.service';

describe('BulkUserImportService', () => {
  const getRequestedSchools = jest.fn().mockResolvedValue([]);
  const schoolsRepository = {
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: getRequestedSchools,
    })),
  };
  const getExistingUsers = jest.fn().mockResolvedValue([]);
  const usersRepository = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      getMany: getExistingUsers,
    })),
  };
  const dataSource = {
    getRepository: jest.fn((entity) =>
      entity === School ? schoolsRepository : usersRepository,
    ),
  } as unknown as DataSource;
  const createUser = jest.fn();
  const adminUsersService = {
    create: createUser,
  } as unknown as AdminUsersService;
  const service = new BulkUserImportService(dataSource, adminUsersService);

  beforeEach(() => jest.clearAllMocks());

  it('previews valid and invalid CSV rows without exposing passwords', async () => {
    const csv = [
      'nombre,apellido,correo,rol,colegio_codigo,contrasena_temporal,estado',
      'Ana,Pérez,ana@mendoza.gov.ar,Administrador,,Temporal!Clave2026,activo',
      'X,,correo-invalido,Colegio,NO-EXISTE,123,bloqueado',
    ].join('\n');

    const preview = await service.preview(
      file('usuarios.csv', Buffer.from(csv)),
    );

    expect(preview.validCount).toBe(1);
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]).not.toHaveProperty('temporaryPassword');
    expect(preview.rows[1].errors.length).toBeGreaterThan(3);
    expect(getRequestedSchools).toHaveBeenCalledTimes(1);
  });

  it('reads XLSX files using the same validation rules', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Usuarios');
    worksheet.addRow([
      'nombre',
      'apellido',
      'correo',
      'rol',
      'colegio_codigo',
      'contrasena_temporal',
      'estado',
    ]);
    worksheet.addRow([
      'Laura',
      'Gómez',
      'laura@mendoza.gov.ar',
      'Administrador',
      '',
      'Temporal!Clave2026',
      'activo',
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await service.preview(file('usuarios.xlsx', buffer));

    expect(preview).toMatchObject({
      totalRows: 1,
      validCount: 1,
      errorCount: 0,
    });
  });

  it('imports only valid rows and reports invalid rows', async () => {
    const csv = [
      'nombre,apellido,correo,rol,colegio_codigo,contrasena_temporal,estado',
      'Ana,Pérez,ana@mendoza.gov.ar,Administrador,,Temporal!Clave2026,activo',
      'Error,Fila,no-es-correo,Administrador,,Temporal!Clave2026,activo',
    ].join('\n');
    createUser.mockResolvedValue({
      id: 'created-id',
      email: 'ana@mendoza.gov.ar',
    });

    const result = await service.import(
      file('usuarios.csv', Buffer.from(csv)),
      { id: 'actor-id' } as never,
    );

    expect(result.importedCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(createUser).toHaveBeenCalledTimes(1);
  });
});

function file(originalname: string, buffer: Buffer): Express.Multer.File {
  return { originalname, buffer } as Express.Multer.File;
}
