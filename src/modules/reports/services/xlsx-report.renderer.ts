import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Row, Worksheet } from 'exceljs';
import type { EvaluationQuestionSnapshot } from '../../evaluation/evaluation-snapshot.type';
import { spreadsheetSafeCell } from '../../exports/spreadsheet-cell.util';
import type { IndividualReportViewModel } from '../report.types';
import { REPORT_THEME } from '../report-theme';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Representa en un único libro el envío inmutable y su resultado histórico.
 *
 * El snapshot de evaluación es la autoridad. Departamento y gestión ausentes
 * pueden venir completados campo a campo en el ViewModel desde el snapshot de
 * la presentación o su rectificación histórica exacta y validada; esa
 * resolución nunca consulta la ficha vigente ni persiste cambios. Las preguntas
 * excluidas se separan y nunca exponen una respuesta residual histórica.
 */
@Injectable()
export class XlsxReportRenderer {
  static readonly mimeType = XLSX_MIME;

  async report(view: IndividualReportViewModel): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = view.branding.programName;
    workbook.subject = `Envío y resultado histórico - ${view.campaign.name}`;
    workbook.title = `Reporte individual - ${view.school.name}`;
    workbook.company = view.branding.organizations;

    this.addSummary(workbook, view);
    this.addDimensions(workbook, view);
    this.addAnswers(workbook, view);
    this.addExclusions(workbook, view);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private addSummary(
    workbook: ExcelJS.Workbook,
    view: IndividualReportViewModel,
  ) {
    const sheet = workbook.addWorksheet('Resumen', this.sheetOptions());
    sheet.columns = [
      { header: 'Sección', key: 'section', width: 22 },
      { header: 'Dato', key: 'label', width: 34 },
      { header: 'Valor histórico', key: 'value', width: 72 },
    ];
    this.styleHeader(sheet.getRow(1));

    const respondent = view.submission.originalRespondent;
    const alerts = (view.result.stars.alerts ?? []).map((alert) =>
      typeof alert.message === 'string' ? alert.message : JSON.stringify(alert),
    );
    const rows: Array<[string, string, unknown]> = [
      ['Institución', 'Programa', view.branding.programName],
      ['Institución', 'Organismos', view.branding.organizations],
      ['Escuela', 'Nombre', view.school.name],
      ['Escuela', 'CUE', view.school.cue],
      ['Escuela', 'Director/a', view.school.directorName],
      ['Escuela', 'Departamento', view.school.department ?? ''],
      ['Escuela', 'Localidad', view.school.locality],
      ['Escuela', 'Gestión', view.school.managementType ?? ''],
      ['Escuela', 'Ámbito', view.school.scope],
      ['Escuela', 'Tipo de educación', view.school.educationLevel],
      [
        'Escuela',
        'Niveles educativos',
        view.school.educationLevels?.length
          ? view.school.educationLevels
              .map(
                ({ code, label, enrollment }) =>
                  `${label} [${code}]${enrollment === null ? '' : ` - matrícula: ${enrollment}`}`,
              )
              .join('\n')
          : 'Sin datos estructurados',
      ],
      [
        'Escuela',
        'Turno',
        view.school.shiftCatalog?.label ?? view.school.shift,
      ],
      ['Escuela', 'Dirección', view.school.address],
      ['Escuela', 'Código postal', view.school.postalCode ?? ''],
      ['Escuela', 'Teléfono institucional', view.school.phone ?? ''],
      ['Escuela', 'Correo institucional', view.school.email ?? ''],
      ['Campaña', 'Nombre', view.campaign.name],
      [
        'Campaña',
        'Período',
        `${this.date(view.campaign.startsAt)} al ${this.date(view.campaign.endsAt)}`,
      ],
      ['Cuestionario', 'Nombre', view.survey.name],
      [
        'Cuestionario',
        'Versión',
        `v${view.survey.version.number} - ${view.survey.version.title}`,
      ],
      ['Envío', 'Fecha (Mendoza)', this.dateTime(view.submission.submittedAt)],
      ['Envío', 'Identificador', view.submission.id],
      [
        'Envío',
        'Respondente original',
        `${respondent.firstName} ${respondent.lastName}`,
      ],
      ['Envío', 'Correo del respondente', respondent.email],
      ['Resultado', 'Puntaje general', this.number(view.result.generalScore)],
      ['Resultado', 'Numerador', this.number(view.result.numerator)],
      ['Resultado', 'Denominador', view.result.denominator],
      [
        'Resultado',
        'Estrellas base',
        view.result.stars.baseValue ?? 'Sin dato histórico',
      ],
      [
        'Resultado',
        'Estrellas finales',
        view.result.stars.value ?? 'Sin clasificación',
      ],
      [
        'Resultado',
        'Alertas',
        alerts.length ? alerts.join('\n') : 'Sin alertas',
      ],
      [
        'Resultado',
        'Bloqueos de certificación',
        view.result.stars.blockingReasons.length
          ? view.result.stars.blockingReasons.join('\n')
          : 'Sin bloqueos',
      ],
      ['Trazabilidad', 'Algoritmo', view.algorithm.version],
      [
        'Trazabilidad',
        'Fecha de cálculo (Mendoza)',
        this.dateTime(view.algorithm.calculatedAt),
      ],
      [
        'Trazabilidad',
        'Configuración de estrellas',
        view.result.stars.configuration?.versionCode ??
          view.result.stars.ruleVersion ??
          'Sin versión informada',
      ],
    ];
    rows.forEach(([section, label, value]) =>
      sheet.addRow({
        section: this.safe(section),
        label: this.safe(label),
        value: this.cell(value),
      }),
    );
    this.finishSheet(sheet, 3);
  }

  private addDimensions(
    workbook: ExcelJS.Workbook,
    view: IndividualReportViewModel,
  ) {
    const sheet = workbook.addWorksheet('Dimensiones', this.sheetOptions());
    sheet.columns = [
      { header: 'Código', key: 'code', width: 24 },
      { header: 'Dimensión', key: 'title', width: 48 },
      { header: 'Numerador', key: 'numerator', width: 16 },
      { header: 'Denominador', key: 'denominator', width: 16 },
      { header: 'Puntaje', key: 'score', width: 14 },
      { header: 'Área crítica', key: 'critical', width: 16 },
      { header: 'Valor observado', key: 'criticalValue', width: 18 },
      { header: 'Umbral', key: 'criticalThreshold', width: 14 },
      { header: 'Regla', key: 'criticalRule', width: 24 },
    ];
    this.styleHeader(sheet.getRow(1));
    this.orderedDimensions(view).forEach((dimension) => {
      const criticality = dimension.result.criticality;
      sheet.addRow({
        code: this.safe(dimension.code),
        title: this.safe(dimension.title),
        numerator: this.number(dimension.result.numerator),
        denominator: dimension.result.denominator,
        score: this.number(dimension.result.score),
        critical: criticality?.isCritical ? 'Sí' : 'No',
        criticalValue: this.number(criticality?.value),
        criticalThreshold: this.number(criticality?.threshold),
        criticalRule: this.safe(criticality?.ruleVersion ?? ''),
      });
    });
    this.finishSheet(sheet, 9);
  }

  private addAnswers(
    workbook: ExcelJS.Workbook,
    view: IndividualReportViewModel,
  ) {
    const sheet = workbook.addWorksheet('Respuestas', this.sheetOptions());
    sheet.columns = this.questionColumns([
      { header: 'Respuesta declarada', key: 'answer', width: 44 },
      { header: 'Puntaje utilizado', key: 'score', width: 18 },
      { header: 'Estado', key: 'answerStatus', width: 16 },
    ]);
    this.styleHeader(sheet.getRow(1));
    for (const entry of this.orderedQuestions(view)) {
      if (entry.question.applicability.status !== 'applicable') continue;
      sheet.addRow({
        ...this.questionCells(entry),
        answer: this.answer(entry.question),
        score: this.number(entry.question.scoreUsed),
        answerStatus: entry.question.answer ? 'Respondida' : 'Sin respuesta',
      });
    }
    this.finishSheet(sheet, sheet.columns.length);
  }

  private addExclusions(
    workbook: ExcelJS.Workbook,
    view: IndividualReportViewModel,
  ) {
    const sheet = workbook.addWorksheet('Exclusiones', this.sheetOptions());
    sheet.columns = this.questionColumns([
      { header: 'Código del motivo', key: 'reasonCode', width: 28 },
      { header: 'Motivo de exclusión', key: 'reason', width: 58 },
    ]);
    this.styleHeader(sheet.getRow(1));
    for (const entry of this.orderedQuestions(view)) {
      if (entry.question.applicability.status !== 'excluded') continue;
      sheet.addRow({
        ...this.questionCells(entry),
        reasonCode: this.safe(entry.question.applicability.reasonCode ?? ''),
        reason: this.safe(
          entry.question.applicability.reasonDescription ??
            'Sin motivo informado',
        ),
      });
    }
    this.finishSheet(sheet, sheet.columns.length);
  }

  private orderedDimensions(view: IndividualReportViewModel) {
    return view.survey.dimensions.slice().sort((left, right) => {
      return left.order - right.order || left.code.localeCompare(right.code);
    });
  }

  private orderedQuestions(view: IndividualReportViewModel) {
    return this.orderedDimensions(view).flatMap((dimension) =>
      dimension.sections
        .slice()
        .sort(
          (left, right) =>
            left.order - right.order || left.code.localeCompare(right.code),
        )
        .flatMap((section) =>
          section.questions
            .slice()
            .sort(
              (left, right) =>
                left.order - right.order || left.code.localeCompare(right.code),
            )
            .map((question) => ({ dimension, section, question })),
        ),
    );
  }

  private questionColumns(extra: Array<Partial<ExcelJS.Column>>) {
    return [
      { header: 'Código dimensión', key: 'dimensionCode', width: 24 },
      { header: 'Dimensión', key: 'dimensionTitle', width: 42 },
      { header: 'Código sección', key: 'sectionCode', width: 22 },
      { header: 'Sección', key: 'sectionTitle', width: 42 },
      { header: 'Código pregunta', key: 'questionCode', width: 20 },
      { header: 'Texto histórico', key: 'prompt', width: 72 },
      { header: 'Obligatoria', key: 'required', width: 15 },
      ...extra,
    ] as Array<Partial<ExcelJS.Column>>;
  }

  private questionCells(
    entry: ReturnType<XlsxReportRenderer['orderedQuestions']>[number],
  ) {
    return {
      dimensionCode: this.safe(entry.dimension.code),
      dimensionTitle: this.safe(entry.dimension.title),
      sectionCode: this.safe(entry.section.code),
      sectionTitle: this.safe(entry.section.title),
      questionCode: this.safe(entry.question.code),
      prompt: this.safe(entry.question.prompt),
      required: entry.question.required ? 'Sí' : 'No',
    };
  }

  private answer(question: EvaluationQuestionSnapshot) {
    if (!question.answer) return '';
    return this.cell(
      question.answer.selectedOption?.label ?? question.answer.value ?? '',
    );
  }

  private sheetOptions(): Partial<ExcelJS.AddWorksheetOptions> {
    return {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { defaultRowHeight: 18 },
      pageSetup: {
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        orientation: 'landscape',
      },
    };
  }

  private styleHeader(row: Row) {
    row.height = 24;
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: this.argb(REPORT_THEME.primary) },
    };
    row.alignment = { vertical: 'middle', wrapText: true };
  }

  private finishSheet(sheet: Worksheet, columnCount: number) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(sheet.rowCount, 1), column: columnCount },
    };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { vertical: 'top', wrapText: true };
      if (rowNumber % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: this.argb(REPORT_THEME.surfaceMuted) },
        };
      }
    });
  }

  private number(value: string | number | null | undefined): number | '' {
    if (value === null || value === undefined || value === '') return '';
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : '';
  }

  private safe(value: unknown) {
    return spreadsheetSafeCell(value);
  }

  private cell(value: unknown) {
    return spreadsheetSafeCell(value);
  }

  private date(value: string) {
    return this.dateParts(value).date;
  }

  private dateTime(value: string | null) {
    if (!value) return '';
    const parts = this.dateParts(value);
    return `${parts.date} ${parts.time} (Mendoza)`;
  }

  private dateParts(value: string) {
    const parts = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Mendoza',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((candidate) => candidate.type === type)?.value ?? '';
    return {
      date: `${part('day')}/${part('month')}/${part('year')}`,
      time: `${part('hour')}:${part('minute')}:${part('second')}`,
    };
  }

  private argb(hex: string) {
    return `FF${hex.replace('#', '').toUpperCase()}`;
  }
}
