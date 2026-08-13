import { Injectable } from '@nestjs/common';
import PdfPrinter from 'pdfmake';
import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';
import type { IndividualReportViewModel } from '../report.types';
import { REPORT_THEME } from '../report-theme';

@Injectable()
export class PdfReportRenderer {
  private readonly printer = new PdfPrinter({
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  });

  report(view: IndividualReportViewModel) {
    const dimensions = view.survey.dimensions
      .slice()
      .sort((left, right) => left.order - right.order);
    const questions = dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) =>
        section.questions.map((question) => ({ dimension, section, question })),
      ),
    );
    const answers = questions.filter(
      ({ question }) =>
        question.applicability.status === 'applicable' && question.answer,
    );
    const excluded = questions.filter(
      ({ question }) => question.applicability.status === 'excluded',
    );
    return this.document({
      ...this.base(view, 'Reporte individual de evaluación'),
      content: [
        ...this.header(view, 'Reporte individual de evaluación'),
        this.summary(view),
        { text: 'Resultados por dimensión', style: 'sectionTitle' },
        {
          columns: [
            {
              width: '45%',
              table: {
                headerRows: 1,
                dontBreakRows: true,
                widths: ['*', 54],
                body: [
                  ['Dimensión', 'Puntaje'].map((text) =>
                    this.tableHeader(text),
                  ),
                  ...dimensions.map((dimension) => [
                    dimension.title,
                    dimension.result.score === null
                      ? 'Sin datos'
                      : this.score(dimension.result.score),
                  ]),
                ],
              },
            },
            { width: '55%', svg: view.radarSvg, fit: [260, 260] },
          ],
          columnGap: 12,
        },
        { text: 'Alertas y áreas críticas', style: 'sectionTitle' },
        this.alerts(view),
        this.questionTable(
          'Respuestas aplicables',
          answers.map(({ dimension, question }) => ({
            stack: [
              { text: `${question.code} - ${dimension.title}`, bold: true },
              { text: question.prompt },
              {
                text: `Respuesta: ${question.answer?.selectedOption?.label ?? JSON.stringify(question.answer?.value ?? '')} - Puntaje: ${question.scoreUsed ?? 's/d'}`,
                color: REPORT_THEME.muted,
              },
            ],
          })),
          'No se registraron respuestas aplicables.',
          true,
        ),
        this.questionTable(
          'Preguntas excluidas',
          excluded.map(({ question }) => ({
            text: `${question.code}: ${question.prompt} - ${question.applicability.reasonDescription}`,
          })),
          'No se registraron exclusiones.',
        ),
        { text: 'Información del cálculo', style: 'sectionTitle' },
        {
          text: 'Método: Promedio de las preguntas aplicables. Las preguntas excluidas por las reglas del cuestionario no afectan el resultado.',
        },
        {
          text: 'Configuración de evaluación: Versión vigente al momento del cálculo.',
        },
        {
          text: `Fecha de cálculo: ${this.compactDateTime(view.algorithm.calculatedAt)}.`,
        },
        ...this.signature(view),
      ],
    } as unknown as TDocumentDefinitions);
  }

  receipt(view: IndividualReportViewModel) {
    return this.document({
      ...this.base(view, 'Comprobante de envío'),
      content: [
        ...this.header(view, 'Comprobante de envío'),
        {
          text: 'La presentación institucional fue recibida correctamente.',
          style: 'lead',
          margin: [0, 20, 0, 20],
        },
        this.keyValues([
          ['Escuela', view.school.name],
          ['CUE', view.school.cue],
          ['Etapa', view.campaign.name],
          [
            'Versión',
            `v${view.survey.version.number} - ${view.survey.version.title}`,
          ],
          ['Fecha de envío', this.date(view.submission.submittedAt)],
          [
            'Respondente',
            `${view.submission.originalRespondent.firstName} ${view.submission.originalRespondent.lastName} (${view.submission.originalRespondent.email})`,
          ],
          ['Identificador de presentación', view.submission.id],
        ]),
        ...(view.branding.verificationUrl
          ? [
              {
                text: `Verificación: ${view.branding.verificationUrl}/${view.submission.id}`,
                margin: [0, 20, 0, 0],
              } as Content,
            ]
          : []),
        ...this.signature(view),
      ],
    } as unknown as TDocumentDefinitions);
  }

  private document(definition: TDocumentDefinitions) {
    return this.printer.createPdfKitDocument(definition);
  }

  private base(view: IndividualReportViewModel, title: string) {
    return {
      info: {
        title,
        subject: view.campaign.name,
        author: view.branding.programName,
      },
      pageSize: 'A4' as const,
      pageMargins: [46, 52, 46, 52] as [number, number, number, number],
      defaultStyle: {
        font: 'Helvetica',
        fontSize: 9,
        color: REPORT_THEME.text,
      },
      styles: {
        title: { fontSize: 18, bold: true, color: REPORT_THEME.primary },
        subtitle: { fontSize: 10, color: REPORT_THEME.muted },
        lead: { fontSize: 12, bold: true, color: REPORT_THEME.primary },
        sectionTitle: {
          fontSize: 12,
          bold: true,
          color: REPORT_THEME.primary,
          margin: [0, 18, 0, 8] as [number, number, number, number],
        },
      },
      header: (currentPage: number) =>
        currentPage === 1
          ? { text: '' }
          : {
              text: `${view.branding.programName} - ${view.campaign.name}`,
              margin: [46, 20, 46, 0],
              fontSize: 8,
              color: REPORT_THEME.mutedSoft,
            },
      footer: (current: number, total: number) => ({
        columns: [
          { text: view.branding.programName, margin: [46, 0, 0, 0] },
          {
            text: `Página ${current} de ${total}`,
            alignment: 'right',
            margin: [0, 0, 46, 0],
          },
        ],
        fontSize: 8,
        color: REPORT_THEME.mutedSoft,
      }),
    };
  }

  private header(view: IndividualReportViewModel, title: string): Content[] {
    const logoWidth = Math.min(
      180,
      Math.floor(470 / Math.max(view.branding.logos.length, 1)) - 10,
    );
    const logos: Content = view.branding.logos.length
      ? {
          columns: view.branding.logos.map((image) => ({
            image,
            fit: [logoWidth, 50] as [number, number],
            margin: [0, 0, 10, 0] as [number, number, number, number],
          })),
          margin: [0, 0, 0, 6],
        }
      : {
          text: `${view.branding.organizations} - ${view.branding.programName}`,
          bold: true,
          color: REPORT_THEME.primary,
          margin: [0, 0, 0, 12],
        };
    return [
      logos,
      ...(view.branding.logos.length
        ? [
            {
              text: view.branding.organizations,
              fontSize: 8,
              color: REPORT_THEME.muted,
              margin: [0, 0, 0, 12],
            } as Content,
          ]
        : []),
      { text: title, style: 'title' },
      {
        text: `${view.campaign.name} - ${view.survey.name} v${view.survey.version.number}`,
        style: 'subtitle',
        margin: [0, 3, 0, 14],
      },
    ];
  }

  private summary(view: IndividualReportViewModel): Content {
    return {
      stack: [
        this.keyValues([
          ['Escuela', view.school.name],
          ['CUE', view.school.cue],
          ['Director/a', view.school.directorName],
          ['Departamento', view.school.department ?? null],
          ['Localidad', view.school.locality],
          ['Gestión', view.school.managementType ?? null],
          ['Ámbito', view.school.scope],
          ['Jornada', view.school.shiftCatalog?.label ?? view.school.shift],
          ['Fecha de envío', this.date(view.submission.submittedAt)],
          [
            'Respondente original',
            `${view.submission.originalRespondent.firstName} ${view.submission.originalRespondent.lastName}`,
          ],
        ]),
        {
          columns: [
            {
              text: `Puntaje general\n${this.score(view.result.generalScore)}`,
              style: 'lead',
              alignment: 'center',
              margin: [0, 14, 0, 0],
            },
            {
              text: `Clasificación\n${this.stars(view.result.stars.value)}`,
              style: 'lead',
              color: REPORT_THEME.accentText,
              alignment: 'center',
              margin: [0, 14, 0, 0],
            },
            {
              text: `Base del cálculo\nNumerador: ${view.result.numerator} - Denominador: ${view.result.denominator}`,
              alignment: 'center',
              margin: [0, 14, 0, 0],
            },
          ],
        },
      ],
    };
  }

  private alerts(view: IndividualReportViewModel): Content {
    const alerts = view.result.stars.alerts ?? [];
    if (!alerts.length)
      return {
        text: 'No se registraron alertas.',
        color: REPORT_THEME.muted,
      };
    return {
      ul: alerts.map((alert) =>
        typeof alert.message === 'string'
          ? alert.message
          : JSON.stringify(alert),
      ),
      color: REPORT_THEME.critical,
    };
  }

  private keyValues(entries: Array<[string, string | null]>): Content {
    return {
      table: {
        widths: [130, '*'],
        body: entries.map(([label, value]) => [
          { text: label, bold: true, fillColor: REPORT_THEME.surfaceMuted },
          value ?? 'Sin dato',
        ]),
      },
      layout: 'lightHorizontalLines',
    };
  }

  private signature(view: IndividualReportViewModel): Content[] {
    const content: Content[] = [];
    if (view.branding.signatureImage)
      content.push({
        image: view.branding.signatureImage,
        fit: [130, 55],
        margin: [0, 26, 0, 2],
      });
    if (view.branding.signer)
      content.push({
        text: `${view.branding.signer}${view.branding.signerPosition ? `\n${view.branding.signerPosition}` : ''}`,
        alignment: 'center',
        margin: [0, 24, 0, 0],
      });
    if (view.branding.legalText)
      content.push({
        text: view.branding.legalText,
        fontSize: 7,
        color: REPORT_THEME.mutedSoft,
        margin: [0, 20, 0, 0],
      });
    return content.length
      ? [
          {
            stack: content,
            unbreakable: true,
          },
        ]
      : [];
  }

  private questionTable(
    title: string,
    rows: Content[],
    emptyMessage: string,
    pageBreakBefore = false,
  ): Content {
    return {
      pageBreak: pageBreakBefore ? 'before' : undefined,
      table: {
        headerRows: 1,
        keepWithHeaderRows: 1,
        dontBreakRows: true,
        widths: ['*'],
        body: [
          [
            {
              text: title,
              style: 'sectionTitle',
              margin: [0, 8, 0, 5],
            },
          ],
          ...(rows.length
            ? rows.map((row) => [
                {
                  stack: [row],
                  margin: [0, 0, 0, 7],
                },
              ])
            : [
                [
                  {
                    text: emptyMessage,
                    color: REPORT_THEME.muted,
                  },
                ],
              ]),
        ],
      },
      layout: 'noBorders',
    } as Content;
  }

  private tableHeader(text: string): TableCell {
    return {
      text,
      bold: true,
      color: REPORT_THEME.surface,
      fillColor: REPORT_THEME.primary,
    };
  }

  private score(value: string) {
    return `${Number(value).toFixed(2)} / 100`;
  }

  private stars(value: number | null) {
    if (!value) return 'Sin clasificación';
    return `${value} ${value === 1 ? 'estrella' : 'estrellas'}`;
  }

  private date(value: string | null) {
    return value
      ? new Intl.DateTimeFormat('es-AR', {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: 'America/Argentina/Mendoza',
        }).format(new Date(value))
      : 'Sin fecha';
  }

  private compactDateTime(value: string | null) {
    if (!value) return 'Sin fecha';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin fecha';
    const parts = new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: 'America/Argentina/Mendoza',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`;
  }
}
