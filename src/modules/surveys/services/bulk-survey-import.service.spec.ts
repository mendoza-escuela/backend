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

  it('acepta planillas existentes con los encabezados anteriores', async () => {
    const legacyHeaders = [
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
    const legacyRow = {
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
    };

    const preview = await service.preview(
      csvFileWithHeaders(legacyHeaders, [legacyRow]),
    );

    expect(preview.canImport).toBe(true);
    expect(preview.rows[0]).toMatchObject({
      dimensionCode: OfficialSurveyDimensionCode.InstitutionalCommitment,
      sectionCode: 'general',
      questionCode: 'p001',
      optionCode: 'si',
    });
  });

  it('informa puntajes inválidos por fila', async () => {
    const preview = await service.preview(
      csvFile([
        validRow({
          puntaje: '101',
        }),
      ]),
    );

    expect(preview.canImport).toBe(false);
    expect(preview.rows[0].errors).toEqual(
      expect.arrayContaining([expect.stringContaining('entre 0 y 100')]),
    );
  });

  it('acepta cualquier puntaje entero del rango sin inferir escalas por pregunta', async () => {
    const preview = await service.preview(
      csvFile([
        validRow({
          codigo_pregunta: 'p041',
          puntaje: '66',
        }),
      ]),
    );

    expect(preview.canImport).toBe(true);
  });

  it('permite la palabra otro dentro de una respuesta que no representa una opción Otro', async () => {
    const preview = await service.preview(
      csvFile([
        validRow({
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
    async (_optionKey, opcion) => {
      const preview = await service.preview(csvFile([validRow({ opcion })]));

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

  it('rechaza encabezados faltantes', async () => {
    const content = Buffer.from(
      'dimension,seccion,codigo_pregunta\r\ncompromiso_institucional,General,p001',
      'utf8',
    );
    await expect(
      service.preview(file('incompleto.csv', content)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('detecta metadatos inconsistentes para un código repetido', async () => {
    const preview = await service.preview(
      csvFile([
        validRow({ opcion: 'Sí' }),
        validRow({ pregunta: 'Texto diferente', opcion: 'No', puntaje: '0' }),
      ]),
    );
    expect(preview.canImport).toBe(false);
    expect(preview.rows[0].errors.join(' ')).toContain(
      'datos deben ser iguales',
    );
  });

  it('detecta opciones duplicadas', async () => {
    const preview = await service.preview(
      csvFile([validRow({ opcion: 'Sí' }), validRow({ opcion: 'Sí' })]),
    );
    expect(preview.canImport).toBe(false);
    expect(preview.rows[0].errors.join(' ')).toContain('repetida');
  });

  it('detecta orden inválido', async () => {
    const preview = await service.preview(csvFile([validRow({ orden: '0' })]));
    expect(preview.canImport).toBe(false);
    expect(preview.rows[0].errors.join(' ')).toContain('mayor o igual a 1');
  });

  it('rechaza archivos vacíos', async () => {
    await expect(
      service.preview(file('vacio.csv', Buffer.from('', 'utf8'))),
    ).rejects.toBeInstanceOf(BadRequestException);
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
  'dimension',
  'seccion',
  'codigo_pregunta',
  'pregunta',
  'texto_ayuda',
  'opcion',
  'puntaje',
  'obligatoria',
  'orden',
];

function validRow(overrides: Record<string, string> = {}) {
  return {
    dimension: OfficialSurveyDimensionCode.InstitutionalCommitment,
    seccion: 'General',
    codigo_pregunta: 'p001',
    pregunta: '¿Pregunta de prueba?',
    texto_ayuda: '',
    opcion: 'Sí',
    puntaje: '100',
    obligatoria: 'si',
    orden: '1',
    ...overrides,
  };
}

function csvFile(rows: Array<Record<string, string>>) {
  return csvFileWithHeaders(csvHeaders, rows);
}

function csvFileWithHeaders(
  headers: string[],
  rows: Array<Record<string, string>>,
) {
  const content = [
    headers.join(','),
    ...rows.map((row) =>
      headers
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
