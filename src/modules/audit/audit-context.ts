import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';

export type AuditContext = {
  requestId: string;
  sourceIp: string | null;
  request: Request;
  actorUserId?: string;
  securityReason?: string;
};

/** Contexto aislado por solicitud; nunca contiene cuerpos, cookies ni tokens. */
export const auditContext = new AsyncLocalStorage<AuditContext>();

export function identifyAuditActor(userId: string | undefined) {
  const context = auditContext.getStore();
  if (context && userId) context.actorUserId = userId;
}

export function markSecurityReason(reason: string) {
  const context = auditContext.getStore();
  if (context) context.securityReason = reason;
}
