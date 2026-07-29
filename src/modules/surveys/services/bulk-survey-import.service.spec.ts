import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { UserRole } from '../../users/entities/user-role.enum';
import { OfficialSurveyDimensionCode } from '../templates/official-survey-dimensions.template';
import { AdminSurveysService } from './admin-surveys.service';
import { BulkSurveyImportService } from './bulk-survey-import.service';
import { SurveyImportFileService } from './survey-import-file.service';

describe('BulkSurveyImportService', () => {
  const adminSurveysService = {
    createImportedVersion: jest.fn(),
  };
  let service: BulkSurveyImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BulkSurveyImportService(
      adminSurveysService as unknown as AdminSurveysService,
      new SurveyImportFileService(),
    );
  });

  it('genera una plantilla válida y la previsualiza sin guardar datos', async () => {
    const template = await service.template('csv');
    const preview = await service.preview(
      file('plantilla-cuestionario.csv', template.buffer),
    );

    expect(preview).toEqual(
      expect.objectContaining({
        totalRows: 3,
        validCount: 3,
        errorCount: 0,
        canImport: true,
        counts: {
          dimensions: 6,
          sections: 1,
          questions: 1,
          options: 3,
        },
      }),
    );
    expect(adminSurveysService.createImportedVersion).not.toHaveBeenCalled();
  });

  it('genera una plantilla Excel válida y reutilizable', async () => {
    const template = await service.template('xlsx');
    const preview = await service.preview(
      file('plantilla-cuestionario.xlsx', template.buffer),
    );

    expect(template.extension).toBe('xlsx');
    expect(preview).toEqual(
      expect.objectContaining({
        totalRows: 3,
        errorCount: 0,
        canImport: true,
      }),
    );
  });

  it('informa puntajes inválidos y condiciones no soportadas por fila', async () => {
    const preview = await service.preview(
      csvFile([
        validRow({
          puntaje: '75',
          condicion: 'si tiene kiosco',
        }),
      ]),
    );

    expect(preview.canImport).toBe(false);
    expect(preview.rows[0].errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('valores permitidos'),
        expect.stringContaining('condicion'),
      ]),
    );
  });

  it('exige que las preguntas 41 a 43 pertenezcan a Salud Mental', async () => {
    const preview = await service.preview(
      csvFile([
        validRow({
          pregunta_codigo: 'p041',
          dimension_codigo: OfficialSurveyDimensionCode.InstitutionalCommitment,
        }),
      ]),
    );

    expect(preview.rows[0].errors).toEqual(
      expect.arrayContaining([expect.stringContaining('preguntas 41 a 43')]),
    );
  });

  it('permite la palabra otro dentro de una respuesta que no representa una opción Otro', async () => {
    const preview = await service.preview(
      csvFile([
        validRow({
          opcion_codigo: 'enfoque_integral',
          opcion:
            'Implementa Escuelas Promotoras u otro enfoque de promoción de la salud',
        }),
      ]),
    );

    expect(preview.canImport).toBe(true);
    expect(preview.rows[0].errors).toEqual([]);
  });

  it.each([
    ['otro', 'Otro'],
    ['otra_alternativa', 'Otra alternativa (especifique)'],
    ['no_aplica', 'No aplica'],
    ['no_corresponde', 'No corresponde a este establecimiento'],
  ])(
    'rechaza la opción institucional reservada %s',
    async (opcion_codigo, opcion) => {
      const preview = await service.preview(
        csvFile([validRow({ opcion_codigo, opcion })]),
      );

      expect(preview.canImport).toBe(false);
      expect(preview.rows[0].errors).toEqual(
        expect.arrayContaining([expect.stringContaining('no admite')]),
      );
    },
  );

  it('crea una versión borrador sólo cuando toda la planilla es válida', async () => {
    const template = await service.template('csv');
    adminSurveysService.createImportedVersion.mockResolvedValue({
      id: 'version-id',
    });

    await expect(
      service.import(
        'survey-id',
        file('cuestionario.csv', template.buffer),
        { title: 'Importación validada' },
        actor,
      ),
    ).resolves.toEqual({ id: 'version-id' });

    expect(adminSurveysService.createImportedVersion).toHaveBeenCalledWith(
      'survey-id',
      { title: 'Importación validada' },
      expect.arrayContaining([
        expect.objectContaining({
          code: OfficialSurveyDimensionCode.InstitutionalCommitment,
        }),
      ]),
      actor,
    );
  });

  it('no realiza importaciones parciales', async () => {
    await expect(
      service.import(
        'survey-id',
        csvFile([validRow({ puntaje: '101' })]),
        { title: 'Planilla inválida' },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(adminSurveysService.createImportedVersion).not.toHaveBeenCalled();
  });
});

const actor: AuthenticatedUser = {
  id: 'actor-id',
  firstName: 'Admin',
  lastName: 'Test',
  email: 'admin@example.com',
  role: UserRole.Admin,
  sessionId: 'session-id',
  mustChangePassword: false,
  lastLoginAt: null,
};

const csvHeaders = [
  'dimension_codigo',
  'seccion_codigo',
  'seccion',
  'pregunta_codigo',
  'pregunta',
  'texto_ayuda',
  'opcion_codigo',
  'opcion',
  'puntaje',
  'obligatoria',
  'orden',
  'condicion',
];

function validRow(overrides: Record<string, string> = {}) {
  return {
    dimension_codigo: OfficialSurveyDimensionCode.InstitutionalCommitment,
    seccion_codigo: 'general',
    seccion: 'General',
    pregunta_codigo: 'p001',
    pregunta: '¿Pregunta de prueba?',
    texto_ayuda: '',
    opcion_codigo: 'si',
    opcion: 'Sí',
    puntaje: '100',
    obligatoria: 'si',
    orden: '1',
    condicion: '',
    ...overrides,
  };
}

function csvFile(rows: Array<Record<string, string>>) {
  const content = [
    csvHeaders.join(','),
    ...rows.map((row) =>
      csvHeaders
        .map((header) => `"${(row[header] ?? '').replace(/"/g, '""')}"`)
        .join(','),
    ),
  ].join('\r\n');
  return file('cuestionario.csv', Buffer.from(content, 'utf8'));
}

function file(originalname: string, buffer: Buffer): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'text/csv',
    size: buffer.length,
    buffer,
    destination: '',
    filename: originalname,
    path: '',
    stream: null as never,
  };
}
