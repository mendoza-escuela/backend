import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { ImportSurveyVersionDto } from '../dto/import-survey-version.dto';
import {
  SurveyDimensionInputDto,
  SurveyQuestionInputDto,
  SurveySectionInputDto,
} from '../dto/update-survey-version.dto';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import { OFFICIAL_SURVEY_DIMENSIONS } from '../templates/official-survey-dimensions.template';
import { isForbiddenInstitutionalSurveyOption } from '../policies/institutional-survey-option.policy';
import { AdminSurveysService } from './admin-surveys.service';
import {
  SurveyImportFileService,
  SurveyImportRawRecord,
  SurveyImportTemplateFormat,
} from './survey-import-file.service';

type ValidatedSurveyRow = {
  line: number;
  dimensionCode: string;
  sectionCode: string;
  sectionTitle: string;
  questionCode: string;
  question: string;
  helpText: string;
  optionCode: string;
  option: string;
  score: number | null;
  required: boolean | null;
  order: number | null;
  errors: string[];
};

type SurveyImportAnalysis = {
  rows: ValidatedSurveyRow[];
  dimensions: SurveyDimensionInputDto[];
};

/**
 * Aplica las reglas funcionales de la carga institucional y convierte una
 * planilla validada en la estructura versionada persistida por el módulo.
 */
@Injectable()
export class BulkSurveyImportService {
  constructor(
    private readonly adminSurveysService: AdminSurveysService,
    private readonly fileService: SurveyImportFileService,
  ) {}

  template(format: SurveyImportTemplateFormat) {
    return this.fileService.template(format);
  }

  async preview(file: Express.Multer.File) {
    return this.publicPreview(await this.readAndValidate(file));
  }

  async import(
    surveyId: string,
    file: Express.Multer.File,
    dto: ImportSurveyVersionDto,
    actor: AuthenticatedUser,
  ) {
    const analysis = await this.readAndValidate(file);
    const invalidRows = analysis.rows.filter((row) => row.errors.length > 0);
    if (invalidRows.length)
      throw new BadRequestException({
        message:
          'La planilla contiene errores. Corregilos y ejecutá nuevamente la vista previa.',
        errors: invalidRows.map((row) => ({
          line: row.line,
          questionCode: row.questionCode,
          errors: row.errors,
        })),
      });

    return this.adminSurveysService.createImportedVersion(
      surveyId,
      dto,
      analysis.dimensions,
      actor,
    );
  }

  private async readAndValidate(
    file: Express.Multer.File,
  ): Promise<SurveyImportAnalysis> {
    const rows = this.validateRows(await this.fileService.read(file));
    this.validateCrossRowRules(rows);
    return {
      rows,
      dimensions: this.buildStructure(rows.filter((row) => !row.errors.length)),
    };
  }

  private validateRows(records: SurveyImportRawRecord[]): ValidatedSurveyRow[] {
    const officialCodes = new Set<string>(
      OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => dimension.code),
    );
    return records.map((record, index) => {
      const dimensionCode = this.dimensionCode(
        record.dimension || record.dimension_codigo,
      );
      const questionCode = this.code(
        record.codigo_pregunta || record.pregunta_codigo,
      );
      const score = this.integer(record.puntaje);
      const required = this.boolean(record.obligatoria);
      const order = this.integer(record.orden);
      const row: ValidatedSurveyRow = {
        line: index + 2,
        dimensionCode,
        sectionCode: this.code(record.seccion_codigo || record.seccion),
        sectionTitle: record.seccion.trim(),
        questionCode,
        question: record.pregunta.trim(),
        helpText: record.texto_ayuda.trim(),
        optionCode: this.code(record.opcion_codigo || record.opcion),
        option: record.opcion.trim(),
        score,
        required,
        order,
        errors: [],
      };

      if (!officialCodes.has(dimensionCode))
        row.errors.push(
          `dimension: usá el código o título de una de las seis dimensiones oficiales: ${[...officialCodes].join(', ')}.`,
        );
      this.validateCode(row, 'seccion', row.sectionCode);
      this.validateCode(row, 'codigo_pregunta', row.questionCode);
      this.validateCode(row, 'opcion', row.optionCode, 120);
      this.validateText(row, 'seccion', row.sectionTitle, 255);
      this.validateText(row, 'pregunta', row.question, 5000);
      this.validateText(row, 'opcion', row.option, 500);
      if (row.helpText.length > 5000)
        row.errors.push('texto_ayuda: no puede superar 5000 caracteres.');
      if (score === null || score < 0 || score > 100)
        row.errors.push('puntaje: debe ser un entero entre 0 y 100.');
      if (required === null) row.errors.push('obligatoria: usá sí o no.');
      if (order === null || order < 1)
        row.errors.push('orden: debe ser un entero mayor o igual a 1.');
      if (record.condicion?.trim())
        row.errors.push(
          'condicion: las reglas deben configurarse desde la administración de aplicabilidad; dejá esta celda vacía.',
        );
      if (isForbiddenInstitutionalSurveyOption('', row.option))
        row.errors.push(
          'opcion: el cuestionario institucional no admite “Otro” ni “No aplica”.',
        );

      return row;
    });
  }

  private validateCrossRowRules(rows: ValidatedSurveyRow[]) {
    const sectionRows = this.groupBy(
      rows,
      (row) => `${row.dimensionCode}/${row.sectionCode}`,
    );
    for (const groupedRows of sectionRows.values()) {
      const titles = new Set(groupedRows.map((row) => row.sectionTitle));
      if (titles.size > 1)
        groupedRows.forEach((row) =>
          row.errors.push(
            'seccion: el título debe ser igual en todas las filas de la misma sección.',
          ),
        );
    }

    const questionRows = this.groupBy(rows, (row) => row.questionCode);
    for (const [questionCode, groupedRows] of questionRows) {
      if (!questionCode) continue;
      const first = groupedRows[0];
      const metadata = (row: ValidatedSurveyRow) =>
        JSON.stringify({
          dimensionCode: row.dimensionCode,
          sectionCode: row.sectionCode,
          sectionTitle: row.sectionTitle,
          question: row.question,
          helpText: row.helpText,
          required: row.required,
          order: row.order,
        });
      if (groupedRows.some((row) => metadata(row) !== metadata(first)))
        groupedRows.forEach((row) =>
          row.errors.push(
            'codigo_pregunta: sus datos deben ser iguales en todas las filas de opciones.',
          ),
        );

      const optionOccurrences = this.occurrences(
        groupedRows.map((row) => row.optionCode),
      );
      groupedRows
        .filter((row) => (optionOccurrences.get(row.optionCode) ?? 0) > 1)
        .forEach((row) =>
          row.errors.push('opcion: está repetida dentro de la pregunta.'),
        );
    }

    const questionLocations = new Map<string, Set<string>>();
    for (const row of rows) {
      const locations =
        questionLocations.get(row.questionCode) ?? new Set<string>();
      locations.add(`${row.dimensionCode}/${row.sectionCode}`);
      questionLocations.set(row.questionCode, locations);
    }
    for (const row of rows)
      if ((questionLocations.get(row.questionCode)?.size ?? 0) > 1)
        row.errors.push(
          'codigo_pregunta: debe ser único en todo el cuestionario.',
        );

    const orderGroups = this.groupBy(
      rows,
      (row) => `${row.dimensionCode}/${row.sectionCode}/${row.order ?? ''}`,
    );
    for (const groupedRows of orderGroups.values()) {
      const questionCodes = new Set(groupedRows.map((row) => row.questionCode));
      if (questionCodes.size > 1)
        groupedRows.forEach((row) =>
          row.errors.push(
            'orden: no puede repetirse entre preguntas de una misma sección.',
          ),
        );
    }
  }

  private buildStructure(
    validRows: ValidatedSurveyRow[],
  ): SurveyDimensionInputDto[] {
    return OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => {
      const dimensionRows = validRows.filter(
        (row) => row.dimensionCode === String(dimension.code),
      );
      const sectionKeys = [
        ...new Set(dimensionRows.map((row) => row.sectionCode)),
      ];
      return {
        code: dimension.code,
        title: dimension.title,
        description: dimension.description,
        sections: sectionKeys.map((sectionCode) =>
          this.buildSection(
            sectionCode,
            dimensionRows.filter((row) => row.sectionCode === sectionCode),
          ),
        ),
      };
    });
  }

  private buildSection(
    sectionCode: string,
    rows: ValidatedSurveyRow[],
  ): SurveySectionInputDto {
    const questionCodes = [...new Set(rows.map((row) => row.questionCode))];
    const questions = questionCodes
      .map((questionCode) =>
        this.buildQuestion(
          questionCode,
          rows.filter((row) => row.questionCode === questionCode),
        ),
      )
      .sort((left, right) => left.order - right.order);
    return {
      code: sectionCode,
      title: rows[0]?.sectionTitle ?? sectionCode,
      description: null,
      questions: questions.map((question) => ({
        code: question.code,
        type: question.type,
        prompt: question.prompt,
        helpText: question.helpText,
        required: question.required,
        validation: question.validation,
        options: question.options,
      })),
    };
  }

  private buildQuestion(
    questionCode: string,
    rows: ValidatedSurveyRow[],
  ): SurveyQuestionInputDto & { order: number } {
    const first = rows[0];
    return {
      code: questionCode,
      type: SurveyQuestionType.SingleChoice,
      prompt: first.question,
      helpText: first.helpText || null,
      required: first.required ?? false,
      validation: {},
      options: rows.map((row) => ({
        value: row.optionCode,
        label: row.option,
        helpText: null,
        score: row.score,
      })),
      order: first.order ?? 0,
    };
  }

  private publicPreview(analysis: SurveyImportAnalysis) {
    const errors = analysis.rows.filter((row) => row.errors.length > 0);
    const sections = analysis.dimensions.flatMap(
      (dimension) => dimension.sections,
    );
    const questions = sections.flatMap((section) => section.questions);
    const detectedDimensions = analysis.dimensions
      .filter((dimension) => dimension.sections.length)
      .map(({ code, title }) => ({ code, title }));
    return {
      totalRows: analysis.rows.length,
      validCount: analysis.rows.length - errors.length,
      errorCount: errors.length,
      canImport: errors.length === 0,
      counts: {
        dimensions: analysis.dimensions.length,
        sections: sections.length,
        questions: questions.length,
        options: questions.reduce(
          (total, question) => total + question.options.length,
          0,
        ),
      },
      detectedDimensions,
      detectedSections: sections.map(({ code, title }) => ({ code, title })),
      groupedQuestions: questions.map((question) => ({
        code: question.code,
        prompt: question.prompt,
        options: question.options.map(({ label, score }) => ({ label, score })),
      })),
      warnings: [],
      summary: `Se creará una versión borrador con ${questions.length} preguntas y ${questions.reduce((total, question) => total + question.options.length, 0)} opciones.`,
      rows: analysis.rows.map((row) => ({
        line: row.line,
        dimensionCode: row.dimensionCode,
        sectionCode: row.sectionCode,
        questionCode: row.questionCode,
        question: row.question,
        optionCode: row.optionCode,
        option: row.option,
        score: row.score,
        required: row.required,
        order: row.order,
        errors: row.errors,
        issues: row.errors.map((message) => {
          const separator = message.indexOf(':');
          return {
            field: separator > 0 ? message.slice(0, separator) : 'fila',
            receivedValue: null,
            reason:
              separator > 0 ? message.slice(separator + 1).trim() : message,
          };
        }),
      })),
    };
  }

  private validateCode(
    row: ValidatedSurveyRow,
    field: string,
    value: string,
    maxLength = 80,
  ) {
    if (!value || value.length > maxLength || !/^[a-zA-Z0-9_-]+$/.test(value))
      row.errors.push(
        `${field}: debe usar letras, números, guiones o guiones bajos y no superar ${maxLength} caracteres.`,
      );
  }

  private validateText(
    row: ValidatedSurveyRow,
    field: string,
    value: string,
    maxLength: number,
  ) {
    if (!value || value.length > maxLength)
      row.errors.push(
        `${field}: es obligatorio y no puede superar ${maxLength} caracteres.`,
      );
  }

  private normalizeText(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private code(value = '') {
    return this.normalizeText(value).replace(/\s+/g, '_');
  }

  private integer(value = '') {
    const number = Number(value);
    return value.trim() && Number.isInteger(number) ? number : null;
  }

  private boolean(value = ''): boolean | null {
    const normalized = this.normalizeText(value);
    if (['si', 'true', '1'].includes(normalized)) return true;
    if (['no', 'false', '0'].includes(normalized)) return false;
    return null;
  }

  private dimensionCode(value = '') {
    const normalized = this.normalizeText(value);
    return (
      OFFICIAL_SURVEY_DIMENSIONS.find(
        (dimension) =>
          this.normalizeText(String(dimension.code)) === normalized ||
          this.normalizeText(dimension.title) === normalized,
      )?.code ?? this.code(value)
    );
  }

  private occurrences(values: string[]) {
    const result = new Map<string, number>();
    values.forEach((value) => result.set(value, (result.get(value) ?? 0) + 1));
    return result;
  }

  private groupBy<T>(
    values: T[],
    keyFor: (value: T) => string,
  ): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const value of values) {
      const key = keyFor(value);
      const group = grouped.get(key) ?? [];
      group.push(value);
      grouped.set(key, group);
    }
    return grouped;
  }
}
