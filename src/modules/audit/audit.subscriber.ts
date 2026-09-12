import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
} from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { auditContext } from './audit-context';
import { sanitizeAuditChanges } from './audit-sanitizer';

@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface<AuditLog> {
  listenTo() {
    return AuditLog;
  }

  beforeInsert(event: InsertEvent<AuditLog>) {
    const context = auditContext.getStore();
    event.entity.requestId ??= context?.requestId ?? null;
    event.entity.sourceIp ??= context?.sourceIp ?? null;
    event.entity.service ??= 'backend';
    event.entity.severity ??= 'info';
    event.entity.changes = sanitizeAuditChanges(
      event.entity.changes ?? {},
    ) as Record<string, unknown>;
  }
}
