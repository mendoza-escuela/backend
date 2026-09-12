import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditQueryDto } from '../dto/audit-query.dto';
import { sanitizeAuditChanges } from '../audit-sanitizer';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private lastWriteFailureAt: string | null = null;

  constructor(private readonly dataSource: DataSource) {}

  /** Las escrituras de negocio siguen siendo transaccionales. Los eventos HTTP
   * posteriores a la respuesta usan consola estructurada como respaldo si falla SQL. */
  async record(event: Partial<AuditLog>): Promise<void> {
    const safeEvent = {
      ...event,
      changes: sanitizeAuditChanges(event.changes ?? {}) as Record<
        string,
        unknown
      >,
    };
    // Emisión inmediata al colector del proceso, incluso si PostgreSQL no responde.
    this.logger.log(
      JSON.stringify({ timestamp: new Date().toISOString(), ...safeEvent }),
    );
    try {
      await this.dataSource.getRepository(AuditLog).save(safeEvent);
    } catch {
      this.lastWriteFailureAt = new Date().toISOString();
      this.logger.error(
        JSON.stringify({
          event: 'AUDIT_WRITE_FAILED',
          timestamp: this.lastWriteFailureAt,
          service: 'backend',
          audit: safeEvent,
        }),
      );
    }
  }

  getWriterStatus() {
    return { lastWriteFailureAt: this.lastWriteFailureAt };
  }

  async list(filters: AuditQueryDto) {
    if (
      filters.from &&
      filters.to &&
      new Date(filters.from) > new Date(filters.to)
    ) {
      throw new BadRequestException(
        'La fecha inicial debe ser anterior a la final.',
      );
    }
    const query = this.dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('audit');
    for (const field of [
      'action',
      'severity',
      'actorUserId',
      'requestId',
    ] as const) {
      if (filters[field])
        query.andWhere(`audit.${field} = :${field}`, {
          [field]: filters[field],
        });
    }
    if (filters.from)
      query.andWhere('audit.createdAt >= :from', { from: filters.from });
    if (filters.to)
      query.andWhere('audit.createdAt <= :to', { to: filters.to });
    const [events, total] = await query
      .orderBy('audit.createdAt', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();
    return {
      items: events.map((event) => ({
        ...event,
        changes: sanitizeAuditChanges(event.changes),
      })),
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    };
  }
}
