import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isEmail } from 'class-validator';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { assertStrongPassword } from '../../auth/utils/password-policy';
import { School } from '../../schools/entities/school.entity';
import { UserRole } from '../entities/user-role.enum';
import { UserSchool } from '../entities/user-school.entity';
import { User } from '../entities/user.entity';
import { AdminUsersService } from './admin-users.service';

type ImportRow = {
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole | null;
  schoolCode: string;
  schoolId?: string;
  temporaryPassword: string;
  isActive: boolean | null;
};

type ValidatedRow = ImportRow & { errors: string[] };

@Injectable()
export class BulkUserImportService {
  static readonly maxRows = 500;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly adminUsersService: AdminUsersService,
  ) {}

  template(): Buffer {
    const content = [
      'nombre,apellido,correo,rol,colegio_cue,contrasena_temporal,estado',
      'María,Pérez,maria.perez@escuela.edu.ar,Escuela,500012300,Temporal!2026Clave,activo',
      'Juan,Gómez,juan.gomez@mendoza.gov.ar,Administrador Central,,Temporal!2026Admin,activo',
    ].join('\r\n');
    return Buffer.from(`\uFEFF${content}`, 'utf8');
  }

  async preview(file: Express.Multer.File) {
    const validated = await this.readAndValidate(file);
    return this.publicResult(validated);
  }

  async import(file: Express.Multer.File, actor: AuthenticatedUser) {
    const validated = await this.readAndValidate(file);
    const imported: Array<{
      line: number;
      id: string;
      email: string;
      invitationEmailSent: boolean;
    }> = [];
    const errors = validated
      .filter((row) => row.errors.length > 0)
      .map((row) => ({ line: row.line, email: row.email, errors: row.errors }));

    for (const row of validated.filter(
      (candidate) => candidate.errors.length === 0,
    )) {
      try {
        const user = await this.adminUsersService.create(
          {
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            role: row.role!,
            schoolId: row.schoolId,
            temporaryPassword: row.temporaryPassword,
            isActive: row.isActive!,
          },
          actor,
        );
        imported.push({
          line: row.line,
          id: user.id,
          email: user.email,
          invitationEmailSent: user.invitationEmailSent,
        });
      } catch (error) {
        errors.push({
          line: row.line,
          email: row.email,
          errors: [this.publicError(error)],
        });
      }
    }

    return {
      totalRows: validated.length,
      importedCount: imported.length,
      errorCount: errors.length,
      invitationEmailSentCount: imported.filter(
        (user) => user.invitationEmailSent,
      ).length,
      invitationEmailPendingCount: imported.filter(
        (user) => !user.invitationEmailSent,
      ).length,
      imported,
      errors: errors.sort((a, b) => a.line - b.line),
    };
  }

  private async readAndValidate(
    file: Express.Multer.File,
  ): Promise<ValidatedRow[]> {
    if (!file) throw new BadRequestException('Debés seleccionar un archivo.');
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx'].includes(extension ?? '')) {
      throw new BadRequestException(
        'El archivo debe tener formato CSV o XLSX.',
      );
    }

    let records: Array<Record<string, string>>;
    try {
      records =
        extension === 'csv'
          ? this.readCsv(file.buffer)
          : await this.readWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'No se pudo leer el archivo. Verificá que no esté dañado o protegido con contraseña.',
      );
    }
    if (records.length === 0)
      throw new BadRequestException(
        'El archivo no contiene filas de usuarios.',
      );
    if (records.length > BulkUserImportService.maxRows) {
      throw new BadRequestException(
        `El archivo no puede superar ${BulkUserImportService.maxRows} filas.`,
      );
    }
    return this.validate(records);
  }

  private readCsv(buffer: Buffer): Array<Record<string, string>> {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];
    const headers = this.parseCsvLine(lines[0]).map((header) =>
      this.normalizeHeader(header),
    );
    this.assertHeaders(headers);
    return lines.slice(1).map((line) => {
      const values = this.parseCsvLine(line);
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? '']),
      );
    });
  }

  private async readWorkbook(
    buffer: Buffer,
  ): Promise<Array<Record<string, string>>> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) return [];
    const headers = (worksheet.getRow(1).values as unknown[])
      .slice(1)
      .map((value) => this.normalizeHeader(this.cellToString(value)));
    this.assertHeaders(headers);
    const rows: Array<Record<string, string>> = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = (row.values as unknown[]).slice(1);
      if (values.every((value) => !this.cellToString(value).trim())) return;
      rows.push(
        Object.fromEntries(
          headers.map((header, index) => [
            header,
            this.cellToString(values[index]).trim(),
          ]),
        ),
      );
    });
    return rows;
  }

  private async validate(
    records: Array<Record<string, string>>,
  ): Promise<ValidatedRow[]> {
    const requestedSchoolCues = records
      .map((record) =>
        (record.colegio_cue ?? record.colegio_codigo ?? '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    const uniqueSchoolCues = [...new Set(requestedSchoolCues)];
    const schools = uniqueSchoolCues.length
      ? await this.dataSource
          .getRepository(School)
          .createQueryBuilder('school')
          .select(['school.id', 'school.cue'])
          .where('LOWER(school.cue) IN (:...schoolCues)', {
            schoolCues: uniqueSchoolCues,
          })
          .getMany()
      : [];
    const schoolByCode = new Map(
      schools.map((school) => [school.cue.toLowerCase(), school]),
    );
    const emails = records
      .map((record) => record.correo.trim().toLowerCase())
      .filter(Boolean);
    const existingUsers = emails.length
      ? await this.dataSource
          .getRepository(User)
          .createQueryBuilder('user')
          .where('LOWER(user.email) IN (:...emails)', { emails })
          .getMany()
      : [];
    const existingEmails = new Set(
      existingUsers.map((user) => user.email.toLowerCase()),
    );
    const occurrences = new Map<string, number>();
    emails.forEach((email) =>
      occurrences.set(email, (occurrences.get(email) ?? 0) + 1),
    );
    const schoolOccurrences = new Map<string, number>();
    requestedSchoolCues.forEach((cue) =>
      schoolOccurrences.set(cue, (schoolOccurrences.get(cue) ?? 0) + 1),
    );
    const schoolIds = schools.map((school) => school.id);
    const occupied = schoolIds.length
      ? await this.dataSource
          .getRepository(UserSchool)
          .createQueryBuilder('association')
          .where('association.schoolId IN (:...schoolIds)', { schoolIds })
          .getMany()
      : [];
    const occupiedSchoolIds = new Set(
      occupied.map((association) => association.schoolId),
    );

    return records.map((record, index) => {
      const role = this.parseRole(record.rol);
      const isActive = this.parseStatus(record.estado);
      const email = record.correo.trim().toLowerCase();
      const schoolCue = (
        record.colegio_cue ??
        record.colegio_codigo ??
        ''
      ).trim();
      const school = schoolCue
        ? schoolByCode.get(schoolCue.toLowerCase())
        : undefined;
      const row: ValidatedRow = {
        line: index + 2,
        firstName: record.nombre.trim(),
        lastName: record.apellido.trim(),
        email,
        role,
        schoolCode: schoolCue,
        schoolId: school?.id,
        temporaryPassword: record.contrasena_temporal,
        isActive,
        errors: [],
      };
      if (row.firstName.length < 2 || row.firstName.length > 100)
        row.errors.push('Nombre inválido.');
      if (row.lastName.length < 2 || row.lastName.length > 100)
        row.errors.push('Apellido inválido.');
      if (!isEmail(email) || email.length > 255)
        row.errors.push('Correo inválido.');
      if (!role)
        row.errors.push('Rol inválido; usá Administrador Central o Escuela.');
      if (isActive === null)
        row.errors.push('Estado inválido; usá activo o bloqueado.');
      if (existingEmails.has(email))
        row.errors.push('El correo ya está registrado.');
      if ((occurrences.get(email) ?? 0) > 1)
        row.errors.push('El correo está repetido dentro del archivo.');
      if (role === UserRole.School && !row.schoolCode)
        row.errors.push('El rol Escuela requiere colegio_cue.');
      if (role === UserRole.School && row.schoolCode && !school)
        row.errors.push('El código de colegio no existe.');
      if (school && occupiedSchoolIds.has(school.id))
        row.errors.push('El colegio ya tiene un usuario asociado.');
      if (
        row.schoolCode &&
        (schoolOccurrences.get(row.schoolCode.toLowerCase()) ?? 0) > 1
      )
        row.errors.push('El colegio está repetido dentro del archivo.');
      if (role === UserRole.Admin && row.schoolCode)
        row.errors.push('Un administrador no debe tener colegio asociado.');
      try {
        assertStrongPassword(row.temporaryPassword);
      } catch {
        row.errors.push(
          'La contraseña temporal no cumple la política de seguridad.',
        );
      }
      return row;
    });
  }

  private publicResult(rows: ValidatedRow[]) {
    return {
      totalRows: rows.length,
      validCount: rows.filter((row) => row.errors.length === 0).length,
      errorCount: rows.filter((row) => row.errors.length > 0).length,
      rows: rows.map((row) => ({
        line: row.line,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        role: row.role,
        schoolCode: row.schoolCode || null,
        isActive: row.isActive,
        hasTemporaryPassword: Boolean(row.temporaryPassword),
        errors: row.errors,
      })),
    };
  }

  private assertHeaders(headers: string[]) {
    const required = [
      'nombre',
      'apellido',
      'correo',
      'rol',
      'contrasena_temporal',
      'estado',
    ];
    const missing = required.filter((header) => !headers.includes(header));
    if (
      !headers.includes('colegio_cue') &&
      !headers.includes('colegio_codigo')
    ) {
      missing.push('colegio_cue');
    }
    if (missing.length)
      throw new BadRequestException(
        `Faltan columnas obligatorias: ${missing.join(', ')}.`,
      );
  }

  private normalizeHeader(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_');
  }

  private parseRole(value: string): UserRole | null {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
    if (
      ['admin', 'administrador', 'administrador central'].includes(normalized)
    )
      return UserRole.Admin;
    if (['school', 'colegio', 'escuela'].includes(normalized))
      return UserRole.School;
    return null;
  }

  private parseStatus(value: string): boolean | null {
    const normalized = value.trim().toLowerCase();
    if (['activo', 'active', 'true', '1', 'si', 'sí'].includes(normalized))
      return true;
    if (
      ['bloqueado', 'inactivo', 'inactive', 'false', '0', 'no'].includes(
        normalized,
      )
    )
      return false;
    return null;
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) {
        values.push(value);
        value = '';
      } else value += character;
    }
    values.push(value);
    if (quoted) {
      throw new BadRequestException(
        'El archivo CSV contiene comillas sin cerrar.',
      );
    }
    return values;
  }

  private cellToString(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const cell = value as {
        text?: unknown;
        result?: unknown;
        richText?: Array<{ text?: unknown }>;
      };
      if (typeof cell.text === 'string') return cell.text;
      if (cell.result !== undefined) return this.cellToString(cell.result);
      if (Array.isArray(cell.richText)) {
        return cell.richText
          .map((part) => this.cellToString(part.text))
          .join('');
      }
    }
    return '';
  }

  private publicError(error: unknown): string {
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
