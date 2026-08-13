import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isEmail } from 'class-validator';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { EducationLevelCatalog } from '../entities/education-level-catalog.entity';
import { School } from '../entities/school.entity';
import { SchoolContactType } from '../entities/school-contact.entity';
import { SchoolsService } from './schools.service';

type RawRecord = Record<string, string>;
type ValidatedSchoolRow = {
  line: number;
  cue: string;
  name: string;
  directorName: string;
  schoolNumber: string;
  department: string;
  locality: string;
  address: string;
  postalCode: string;
  educationLevel: string;
  managementType: string;
  scope: string;
  shift: string;
  phone: string;
  email: string;
  referentFirstName: string;
  referentLastName: string;
  referentEmail: string;
  referentPhone: string;
  referentPosition: string;
  enrollment: number | null;
  educationLevels: Array<{ levelId: string; enrollment: number | null }>;
  characteristics: Record<string, string | number | boolean | null>;
  isActive: boolean | null;
  errors: string[];
};

@Injectable()
export class BulkSchoolImportService {
  static readonly maxRows = 500;
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
  ) {}

  template() {
    const headers =
      'cue,nombre,director,numero,departamento,localidad,direccion,codigo_postal,tipo_educacion,niveles_y_matriculas,gestion,ambito,jornada,telefono,correo,referente_nombre,referente_apellido,referente_cargo,referente_correo,referente_telefono,matricula_total,plurigrado,intercultural_bilingue,estado';
    const example =
      '500012300,Escuela Ejemplo,María González,1-001,Capital,Mendoza,Av. Ejemplo 123,5500,Educación común,Inicial: 45 | Primario: 210,Estatal,Urbano,Completa,2614000000,escuela@ejemplo.edu.ar,Ana,Pérez,Secretaria,ana.perez@ejemplo.edu.ar,2614000001,255,no,no,activo';
    return Buffer.from(`\uFEFF${headers}\r\n${example}`, 'utf8');
  }

  async preview(file: Express.Multer.File) {
    return this.publicPreview(await this.readAndValidate(file));
  }

  async import(file: Express.Multer.File, actor: AuthenticatedUser) {
    const rows = await this.readAndValidate(file);
    const imported: Array<{
      line: number;
      id: string;
      cue: string;
      invitationEmailSent: boolean;
    }> = [];
    const errors = rows
      .filter((row) => row.errors.length)
      .map((row) => ({ line: row.line, cue: row.cue, errors: row.errors }));
    for (const row of rows.filter((candidate) => !candidate.errors.length)) {
      try {
        const school = await this.schoolsService.create(
          {
            cue: row.cue,
            name: row.name,
            directorName: row.directorName,
            schoolNumber: row.schoolNumber || undefined,
            department: row.department,
            locality: row.locality,
            address: row.address,
            postalCode: row.postalCode || undefined,
            educationLevel: row.educationLevel,
            managementType: row.managementType,
            scope: row.scope,
            shift: row.shift,
            phone: row.phone || undefined,
            email: row.email || undefined,
            referentFirstName: row.referentFirstName,
            referentLastName: row.referentLastName,
            referentEmail: row.referentEmail || undefined,
            referentPhone: row.referentPhone || undefined,
            contacts: [
              {
                type: SchoolContactType.Respondent,
                firstName: row.referentFirstName,
                lastName: row.referentLastName,
                position: row.referentPosition || undefined,
                email: row.referentEmail || undefined,
                phone: row.referentPhone || undefined,
              },
            ],
            enrollment: row.enrollment,
            educationLevels: row.educationLevels,
            characteristics: row.characteristics,
            isActive: row.isActive!,
          },
          actor,
        );
        imported.push({
          line: row.line,
          id: school.id,
          cue: school.cue,
          invitationEmailSent:
            school.responsibleUserInvitationEmailSent === true,
        });
      } catch (error) {
        errors.push({
          line: row.line,
          cue: row.cue,
          errors: [this.publicError(error)],
        });
      }
    }
    return {
      totalRows: rows.length,
      importedCount: imported.length,
      invitationEmailSentCount: imported.filter(
        ({ invitationEmailSent }) => invitationEmailSent,
      ).length,
      invitationEmailPendingCount: imported.filter(
        ({ invitationEmailSent }) => !invitationEmailSent,
      ).length,
      errorCount: errors.length,
      imported,
      errors: errors.sort((a, b) => a.line - b.line),
    };
  }

  private async readAndValidate(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Debés seleccionar un archivo.');
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx'].includes(extension ?? ''))
      throw new BadRequestException(
        'El archivo debe tener formato CSV o XLSX.',
      );
    let records: RawRecord[];
    try {
      records =
        extension === 'csv'
          ? this.readCsv(file.buffer)
          : await this.readWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'No se pudo leer el archivo. Verificá que no esté dañado o protegido.',
      );
    }
    if (!records.length)
      throw new BadRequestException(
        'El archivo no contiene filas de colegios.',
      );
    if (records.length > BulkSchoolImportService.maxRows)
      throw new BadRequestException(
        `El archivo no puede superar ${BulkSchoolImportService.maxRows} filas.`,
      );
    return this.validate(records);
  }

  private async validate(records: RawRecord[]): Promise<ValidatedSchoolRow[]> {
    const educationLevelCatalogs = await this.dataSource
      .getRepository(EducationLevelCatalog)
      .find({ where: { isActive: true }, order: { order: 'ASC' } });
    const cues = records
      .map((record) => record.cue.trim().toUpperCase())
      .filter(Boolean);
    const existing = cues.length
      ? await this.dataSource
          .getRepository(School)
          .createQueryBuilder('school')
          .where('UPPER(school.cue) IN (:...cues)', { cues })
          .getMany()
      : [];
    const existingCues = new Set(
      existing.map((school) => school.cue.toUpperCase()),
    );
    const occurrences = new Map<string, number>();
    cues.forEach((cue) =>
      occurrences.set(cue, (occurrences.get(cue) ?? 0) + 1),
    );
    return records.map((record, index) => {
      const usesStructuredFormat = 'niveles_y_matriculas' in record;
      const enrollmentText = usesStructuredFormat
        ? record.matricula_total
        : record.matricula;
      const enrollment = this.optionalInteger(enrollmentText);
      const educationLevels = usesStructuredFormat
        ? this.educationLevels(
            record.niveles_y_matriculas,
            educationLevelCatalogs,
          )
        : { value: [], errors: [] };
      const isActive = this.status(record.estado);
      const characteristics = usesStructuredFormat
        ? this.structuredCharacteristics(record)
        : this.characteristics(record.caracteristicas);
      const row: ValidatedSchoolRow = {
        line: index + 2,
        cue: record.cue.trim().toUpperCase(),
        name: record.nombre.trim(),
        directorName: record.director.trim(),
        schoolNumber: record.numero.trim(),
        department: record.departamento.trim(),
        locality: record.localidad.trim(),
        address: record.direccion.trim(),
        postalCode: record.codigo_postal.trim(),
        educationLevel: (record.tipo_educacion || record.nivel || '').trim(),
        managementType: record.gestion.trim(),
        scope: record.ambito.trim(),
        shift: record.jornada.trim(),
        phone: record.telefono.trim(),
        email: record.correo.trim().toLowerCase(),
        referentFirstName: record.referente_nombre.trim(),
        referentLastName: record.referente_apellido.trim(),
        referentEmail: record.referente_correo.trim().toLowerCase(),
        referentPhone: record.referente_telefono.trim(),
        referentPosition: this.optional(record, 'referente_cargo'),
        enrollment: enrollment.value,
        educationLevels: educationLevels.value,
        characteristics: characteristics.value,
        isActive,
        errors: [],
      };
      if (
        row.cue.length < 3 ||
        row.cue.length > 20 ||
        !/^[A-Za-z0-9.-]+$/.test(row.cue)
      )
        row.errors.push('CUE inválido.');
      if (existingCues.has(row.cue))
        row.errors.push('El CUE ya está registrado.');
      if ((occurrences.get(row.cue) ?? 0) > 1)
        row.errors.push('El CUE está repetido dentro del archivo.');
      for (const [label, value, max] of [
        ['Nombre', row.name, 255],
        ['Director/a', row.directorName, 200],
        ['Departamento', row.department, 120],
        ['Localidad', row.locality, 120],
        ['Dirección', row.address, 255],
        ['Nivel', row.educationLevel, 120],
        ['Gestión', row.managementType, 120],
        ['Ámbito', row.scope, 120],
        ['Jornada', row.shift, 120],
        ['Nombre del referente', row.referentFirstName, 100],
        ['Apellido del referente', row.referentLastName, 100],
      ] as const)
        if (value.length < 2 || value.length > max)
          row.errors.push(`${label} inválido.`);
      for (const [label, value, max] of [
        ['Número', row.schoolNumber, 30],
        ['Código postal', row.postalCode, 20],
        ['Teléfono', row.phone, 40],
        ['Teléfono del referente', row.referentPhone, 40],
      ] as const)
        if (value.length > max) row.errors.push(`${label} demasiado largo.`);
      if (row.email && (!isEmail(row.email) || row.email.length > 255))
        row.errors.push('Correo del colegio inválido.');
      if (!row.referentEmail)
        row.errors.push('El correo del referente responsable es obligatorio.');
      else if (!isEmail(row.referentEmail) || row.referentEmail.length > 255)
        row.errors.push('Correo del referente responsable inválido.');
      if (
        row.referentPosition &&
        (row.referentPosition.length < 2 || row.referentPosition.length > 160)
      )
        row.errors.push('Cargo del referente inválido.');
      if (enrollment.error) row.errors.push(enrollment.error);
      row.errors.push(...educationLevels.errors);
      if (isActive === null)
        row.errors.push('Estado inválido; usá activo o inactivo.');
      if (characteristics.error) row.errors.push(characteristics.error);
      return row;
    });
  }

  private publicPreview(rows: ValidatedSchoolRow[]) {
    return {
      totalRows: rows.length,
      validCount: rows.filter((row) => !row.errors.length).length,
      errorCount: rows.filter((row) => row.errors.length).length,
      rows: rows.map((row) => ({
        line: row.line,
        cue: row.cue,
        name: row.name,
        directorName: row.directorName,
        schoolNumber: row.schoolNumber,
        department: row.department,
        locality: row.locality,
        address: row.address,
        educationLevel: row.educationLevel,
        managementType: row.managementType,
        enrollment: row.enrollment,
        educationLevels: row.educationLevels,
        isActive: row.isActive,
        errors: row.errors,
      })),
    };
  }
  private readCsv(buffer: Buffer): RawRecord[] {
    const lines = buffer
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim());
    if (lines.length < 2) return [];
    const headers = this.csvLine(lines[0]).map((value) => this.header(value));
    this.assertHeaders(headers);
    return lines.slice(1).map((line) => {
      const values = this.csvLine(line);
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? '']),
      );
    });
  }
  private async readWorkbook(buffer: Buffer): Promise<RawRecord[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) return [];
    const headers = (sheet.getRow(1).values as unknown[])
      .slice(1)
      .map((value) => this.header(this.cell(value)));
    this.assertHeaders(headers);
    const rows: RawRecord[] = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const values = (row.values as unknown[]).slice(1);
      if (values.every((value) => !this.cell(value).trim())) return;
      rows.push(
        Object.fromEntries(
          headers.map((header, index) => [
            header,
            this.cell(values[index]).trim(),
          ]),
        ),
      );
    });
    return rows;
  }
  private assertHeaders(headers: string[]) {
    const commonRequired = [
      'cue',
      'nombre',
      'director',
      'numero',
      'departamento',
      'localidad',
      'direccion',
      'codigo_postal',
      'gestion',
      'ambito',
      'jornada',
      'telefono',
      'correo',
      'referente_nombre',
      'referente_apellido',
      'referente_correo',
      'referente_telefono',
      'estado',
    ];
    const newFormat = [
      'tipo_educacion',
      'niveles_y_matriculas',
      'matricula_total',
      'plurigrado',
      'intercultural_bilingue',
    ];
    const legacyFormat = ['nivel', 'matricula', 'caracteristicas'];
    const missing = commonRequired.filter(
      (header) => !headers.includes(header),
    );
    if (missing.length)
      throw new BadRequestException(
        `Faltan columnas obligatorias: ${missing.join(', ')}.`,
      );
    if (
      !newFormat.every((header) => headers.includes(header)) &&
      !legacyFormat.every((header) => headers.includes(header))
    )
      throw new BadRequestException(
        'La plantilla debe incluir tipo_educacion, niveles_y_matriculas, matricula_total, plurigrado e intercultural_bilingue.',
      );
  }
  private header(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_');
  }
  private csvLine(line: string) {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) {
        values.push(value);
        value = '';
      } else value += char;
    }
    if (quoted)
      throw new BadRequestException('El CSV contiene comillas sin cerrar.');
    values.push(value);
    return values;
  }
  private cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean')
      return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const cell = value as {
        text?: string;
        result?: unknown;
        richText?: Array<{ text?: string }>;
      };
      if (cell.text) return cell.text;
      if (cell.result !== undefined) return this.cell(cell.result);
      if (cell.richText)
        return cell.richText.map((part) => part.text ?? '').join('');
    }
    return '';
  }
  private optionalInteger(value = ''): {
    value: number | null;
    error?: string;
  } {
    if (!value.trim()) return { value: null };
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 1_000_000
      ? { value: number }
      : {
          value: null,
          error: 'Matrícula total inválida; usá un entero entre 0 y 1000000.',
        };
  }
  private optional(record: RawRecord, key: string) {
    return record[key]?.trim() ?? '';
  }
  private status(value: string): boolean | null {
    const normalized = value.trim().toLowerCase();
    if (['activo', 'true', '1', 'si', 'sí'].includes(normalized)) return true;
    if (['inactivo', 'false', '0', 'no'].includes(normalized)) return false;
    return null;
  }
  private characteristics(value: string): {
    value: Record<string, string | number | boolean | null>;
    error?: string;
  } {
    if (!value.trim()) return { value: {} };
    try {
      const parsed = JSON.parse(value) as unknown;
      if (
        !parsed ||
        Array.isArray(parsed) ||
        typeof parsed !== 'object' ||
        Object.keys(parsed).length > 30 ||
        Object.entries(parsed).some(
          ([key, item]) =>
            key.length > 80 ||
            ['__proto__', 'prototype', 'constructor'].includes(key) ||
            (!['string', 'number', 'boolean'].includes(typeof item) &&
              item !== null),
        )
      )
        return {
          value: {},
          error:
            'Características inválidas; usá un objeto JSON con valores simples.',
        };
      return {
        value: parsed as Record<string, string | number | boolean | null>,
      };
    } catch {
      return { value: {}, error: 'Características no contiene JSON válido.' };
    }
  }

  private structuredCharacteristics(record: RawRecord): {
    value: Record<string, string | number | boolean | null>;
    error?: string;
  } {
    const multigrade = this.yesNo(record.plurigrado);
    const intercultural = this.yesNo(record.intercultural_bilingue);
    const invalid = [
      multigrade.error ? 'plurigrado' : null,
      intercultural.error ? 'intercultural_bilingue' : null,
    ].filter(Boolean);
    return {
      value: {
        isMultigrade: multigrade.value,
        isInterculturalBilingual: intercultural.value,
      },
      ...(invalid.length
        ? {
            error: `${invalid.join(' e ')}: usá sí, no o dejá la celda vacía.`,
          }
        : {}),
    };
  }

  private yesNo(value = ''): { value: boolean | null; error?: true } {
    const normalized = this.normalized(value);
    if (!normalized) return { value: null };
    if (['si', 'true', '1'].includes(normalized)) return { value: true };
    if (['no', 'false', '0'].includes(normalized)) return { value: false };
    return { value: null, error: true };
  }

  private educationLevels(
    value: string,
    catalogs: EducationLevelCatalog[],
  ): {
    value: Array<{ levelId: string; enrollment: number | null }>;
    errors: string[];
  } {
    const errors: string[] = [];
    const selected: Array<{ levelId: string; enrollment: number | null }> = [];
    if (!value.trim())
      return {
        value: [],
        errors: ['Niveles y matrículas: informá al menos un nivel educativo.'],
      };
    for (const part of value.split('|').map((item) => item.trim())) {
      if (!part) continue;
      const separator = part.indexOf(':');
      const levelText = (
        separator >= 0 ? part.slice(0, separator) : part
      ).trim();
      const enrollmentText =
        separator >= 0 ? part.slice(separator + 1).trim() : '';
      const normalizedLevel = this.normalized(levelText);
      const catalog = catalogs.find(
        ({ code, label }) =>
          this.normalized(code) === normalizedLevel ||
          this.normalized(label) === normalizedLevel,
      );
      if (!catalog) {
        errors.push(`Nivel educativo desconocido: “${levelText}”.`);
        continue;
      }
      if (selected.some(({ levelId }) => levelId === catalog.id)) {
        errors.push(`El nivel educativo “${catalog.label}” está repetido.`);
        continue;
      }
      const enrollment = this.optionalInteger(enrollmentText);
      if (enrollment.error) {
        errors.push(`Matrícula de “${catalog.label}” inválida.`);
        continue;
      }
      selected.push({ levelId: catalog.id, enrollment: enrollment.value });
    }
    return { value: selected, errors };
  }

  private normalized(value = '') {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
  private publicError(error: unknown) {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message?: string | string[] }).message;
        return Array.isArray(message)
          ? message.join(' ')
          : (message ?? 'No se pudo importar la fila.');
      }
    }
    return 'No se pudo importar la fila.';
  }
}
