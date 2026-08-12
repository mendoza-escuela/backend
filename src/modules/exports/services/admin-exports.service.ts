import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { applyDashboardSchoolFilters } from '../../dashboard/dashboard-query-filters';
import { EvaluationSnapshot } from '../../evaluation/evaluation-snapshot.type';
import { School } from '../../schools/entities/school.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { AdminExportQueryDto } from '../dto/admin-export-query.dto';
import { spreadsheetSafeCell } from '../spreadsheet-cell.util';

type ExportRow = {
  assignmentId: string;
  cue: string;
  schoolName: string;
  department: string;
  locality: string;
  educationLevel: string;
  educationLevels: string;
  managementType: string;
  scope: string;
  shift: string;
  campaignName: string;
  submissionStatus: SubmissionStatus | null;
  submittedAt: Date | string | null;
  generalScore: string | null;
  stars: number | string | null;
  snapshot: EvaluationSnapshot | null;
};

type ExportKind = 'results' | 'answers';

@Injectable()
export class AdminExportsService {
  private readonly batchSize = 100;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async write(
    kind: ExportKind,
    query: AdminExportQueryDto,
    actor: AuthenticatedUser,
    response: Response,
  ) {
    const campaign = await this.dataSource
      .getRepository(Campaign)
      .findOneBy({ id: query.campaignId });
    if (!campaign) throw new NotFoundException('Etapa no encontrada.');

    const audit = await this.dataSource.getRepository(AuditLog).save({
      actorUserId: actor.id,
      action: 'ADMIN_EXPORT_STARTED',
      entityType: 'Campaign',
      entityId: campaign.id,
      changes: { kind, format: query.format, filters: this.safeFilters(query) },
    });

    const filename = `${kind === 'results' ? 'resultados' : 'respuestas'}-${this.filePart(campaign.name)}.${query.format}`;
    response.setHeader(
      'Content-Type',
      query.format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );

    let count = 0;
    try {
      count =
        query.format === 'xlsx'
          ? await this.writeXlsx(kind, query, response)
          : await this.writeCsv(kind, query, response);
      await this.completeAudit(audit, kind, query, count, 'completed');
    } catch (error) {
      await this.completeAudit(audit, kind, query, count, 'failed');
      throw error;
    }
  }

  private async writeCsv(
    kind: ExportKind,
    query: AdminExportQueryDto,
    response: Response,
  ) {
    try {
      const headers = this.headers(kind);
      response.write(
        `\uFEFF${headers.map((value) => this.csv(value)).join(',')}\r\n`,
      );
      let outputCount = 0;
      await this.eachRow(query, async (row) => {
        for (const values of this.exportRows(kind, row)) {
          const writable = response.write(
            `${values.map((value) => this.csv(String(spreadsheetSafeCell(value)))).join(',')}\r\n`,
          );
          outputCount += 1;
          if (!writable) await once(response, 'drain');
        }
      });
      const completion = finished(response);
      response.end();
      await completion;
      return outputCount;
    } catch (error) {
      response.destroy(this.asError(error));
      throw error;
    }
  }

  private async writeXlsx(
    kind: ExportKind,
    query: AdminExportQueryDto,
    response: Response,
  ) {
    const output = new PassThrough();
    const delivery = pipeline(output, response).then(
      () => null,
      (error: unknown) => error,
    );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: true,
      useSharedStrings: false,
    });
    const worksheet = workbook.addWorksheet(
      kind === 'results' ? 'Resultados' : 'Respuestas',
      { views: [{ state: 'frozen', ySplit: 1 }] },
    );
    const header = worksheet.addRow(this.headers(kind));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF000F9F' },
    };
    header.commit();
    let outputCount = 0;
    try {
      await this.eachRow(query, (row) => {
        for (const values of this.exportRows(kind, row)) {
          worksheet
            .addRow(values.map((value) => spreadsheetSafeCell(value)))
            .commit();
          outputCount += 1;
        }
      });
      worksheet.commit();
      await workbook.commit();
    } catch (error) {
      output.destroy(this.asError(error));
      await delivery;
      throw error;
    }
    const deliveryError = await delivery;
    if (deliveryError) throw this.asError(deliveryError);
    return outputCount;
  }

  /** Itera en lotes estables y nunca materializa el padrón completo. */
  private async eachRow(
    query: AdminExportQueryDto,
    callback: (row: ExportRow) => Promise<void> | void,
  ) {
    let offset = 0;
    while (true) {
      const rows = await this.baseQuery(query)
        .select('assignment.id', 'assignmentId')
        .addSelect('school.cue', 'cue')
        .addSelect('school.name', 'schoolName')
        .addSelect('school.department', 'department')
        .addSelect('school.locality', 'locality')
        .addSelect('school.educationLevel', 'educationLevel')
        .addSelect(
          `COALESCE((
            SELECT STRING_AGG(
              education_level.label || ' [' || education_level.code || ']',
              ', ' ORDER BY school_level."order", education_level.label
            )
            FROM school_education_levels school_level
            INNER JOIN education_level_catalogs education_level
              ON education_level.id = school_level.level_id
            WHERE school_level.school_id = school.id
          ), '')`,
          'educationLevels',
        )
        .addSelect('school.managementType', 'managementType')
        .addSelect('school.scope', 'scope')
        .addSelect('school.shift', 'shift')
        .addSelect('campaign.name', 'campaignName')
        .addSelect('submission.status', 'submissionStatus')
        .addSelect('submission.submittedAt', 'submittedAt')
        .addSelect('evaluation.generalScore', 'generalScore')
        .addSelect('evaluation.stars', 'stars')
        .addSelect('evaluation.snapshot', 'snapshot')
        .orderBy('LOWER(school.name)', 'ASC')
        .addOrderBy('school.cue', 'ASC')
        .addOrderBy('school.id', 'ASC')
        .limit(this.batchSize)
        .offset(offset)
        .getRawMany<ExportRow>();
      for (const row of rows) await callback(row);
      if (rows.length < this.batchSize) return;
      offset += this.batchSize;
    }
  }

  private baseQuery(query: AdminExportQueryDto) {
    const builder = this.dataSource
      .getRepository(CampaignSchool)
      .createQueryBuilder('assignment')
      .innerJoin(School, 'school', 'school.id = assignment.schoolId')
      .innerJoin(Campaign, 'campaign', 'campaign.id = assignment.campaignId')
      .leftJoin(
        'survey_submissions',
        'submission',
        'submission.school_id = school.id AND submission.campaign_id = assignment.campaign_id',
      )
      .leftJoin(
        'evaluation_results',
        'evaluation',
        'evaluation.submission_id = submission.id',
      )
      .where('assignment.campaignId = :campaignId', {
        campaignId: query.campaignId,
      })
      .andWhere('assignment.removedAt IS NULL');
    this.applyFilters(builder, query);
    return builder;
  }

  private applyFilters(
    builder: SelectQueryBuilder<CampaignSchool>,
    query: AdminExportQueryDto,
  ) {
    if (query.search)
      builder.andWhere(
        '(LOWER(school.name) LIKE :search OR LOWER(school.cue) LIKE :search)',
        { search: `%${query.search.toLowerCase()}%` },
      );
    applyDashboardSchoolFilters(builder, query);
  }

  private exportRows(kind: ExportKind, row: ExportRow): unknown[][] {
    return kind === 'results' ? [this.resultRow(row)] : this.answerRows(row);
  }

  private resultRow(row: ExportRow) {
    const snapshot = row.snapshot;
    const dimensions = (snapshot?.survey.dimensions ?? [])
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((dimension) => dimension.result.score)
      .slice(0, 6);
    while (dimensions.length < 6) dimensions.push(null);
    const questions = (snapshot?.survey.dimensions ?? []).flatMap((dimension) =>
      dimension.sections.flatMap((section) => section.questions),
    );
    const applicable = questions.filter(
      ({ applicability }) => applicability.status === 'applicable',
    );
    const answered = applicable.filter(({ answer }) => answer !== null);
    return [
      row.cue,
      row.schoolName,
      row.department,
      row.locality,
      row.educationLevel,
      row.educationLevels,
      row.managementType,
      row.scope,
      row.shift,
      row.campaignName,
      snapshot?.survey.version.number ?? '',
      this.participationStatus(row.submissionStatus),
      this.iso(row.submittedAt),
      this.decimal(row.generalScore),
      this.decimal(snapshot?.result.numerator),
      this.decimal(snapshot?.result.denominator),
      this.decimal(row.stars),
      ...dimensions.map((score) => this.decimal(score)),
      JSON.stringify(snapshot?.result.stars.alerts ?? []),
      applicable.length,
      answered.length,
      applicable.length === answered.length ? 'Completa' : 'Incompleta',
    ];
  }

  private answerRows(row: ExportRow) {
    const snapshot = row.snapshot;
    if (!snapshot) return [];
    return snapshot.survey.dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) =>
        section.questions.map((question) => [
          row.cue,
          row.schoolName,
          row.campaignName,
          snapshot.survey.version.number,
          this.iso(row.submittedAt),
          dimension.code,
          dimension.title,
          question.code,
          question.prompt,
          question.answer?.selectedOption?.label ??
            (question.answer ? JSON.stringify(question.answer.value) : ''),
          this.decimal(question.scoreUsed),
          question.applicability.status === 'applicable' ? 'Sí' : 'No',
          question.applicability.status === 'excluded' ? 'Sí' : 'No',
          question.applicability.reasonDescription,
        ]),
      ),
    );
  }

  private headers(kind: ExportKind) {
    if (kind === 'answers')
      return [
        'CUE',
        'Escuela',
        'Etapa',
        'Versión',
        'Fecha de envío',
        'Código dimensión',
        'Dimensión',
        'Código pregunta',
        'Texto histórico',
        'Respuesta declarada',
        'Puntaje utilizado',
        'Aplicable',
        'Excluida',
        'Motivo de exclusión',
      ];
    return [
      'CUE',
      'Escuela',
      'Departamento',
      'Localidad',
      'Tipo de educación',
      'Niveles educativos',
      'Gestión',
      'Ámbito',
      'Jornada',
      'Etapa',
      'Versión',
      'Estado',
      'Fecha de envío',
      'Puntaje general',
      'Numerador general',
      'Denominador general',
      'Estrellas',
      'Dimensión 1',
      'Dimensión 2',
      'Dimensión 3',
      'Dimensión 4',
      'Dimensión 5',
      'Dimensión 6',
      'Alertas',
      'Preguntas aplicables',
      'Preguntas respondidas',
      'Calidad de datos',
    ];
  }

  private participationStatus(status: SubmissionStatus | null) {
    return status === SubmissionStatus.Submitted
      ? 'Enviada'
      : status === SubmissionStatus.Draft
        ? 'Borrador'
        : 'No iniciada';
  }

  private csv(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private iso(value: Date | string | null) {
    return value ? new Date(value).toISOString() : '';
  }

  private decimal(value: string | number | null | undefined): number | '' {
    if (value === null || value === undefined || value === '') return '';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : '';
  }

  private filePart(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  }

  private safeFilters(query: AdminExportQueryDto) {
    const { format: _format, ...filters } = query;
    void _format;
    return filters;
  }

  private asError(error: unknown) {
    return error instanceof Error
      ? error
      : new Error('Falló la escritura del archivo XLSX.');
  }

  private async completeAudit(
    startedAudit: AuditLog,
    kind: ExportKind,
    query: AdminExportQueryDto,
    rowCount: number,
    outcome: 'completed' | 'failed',
  ) {
    await this.dataSource.getRepository(AuditLog).save({
      actorUserId: startedAudit.actorUserId,
      action:
        outcome === 'completed'
          ? 'ADMIN_EXPORT_COMPLETED'
          : 'ADMIN_EXPORT_FAILED',
      entityType: startedAudit.entityType,
      entityId: startedAudit.entityId,
      changes: {
        startedAuditId: startedAudit.id,
        kind,
        format: query.format,
        filters: this.safeFilters(query),
        outcome,
        rowCount,
      },
    });
  }
}
