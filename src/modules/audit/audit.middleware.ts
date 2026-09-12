import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { AuditService } from './services/audit.service';
import { auditContext } from './audit-context';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { UserRole } from '../users/entities/user-role.enum';

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  constructor(private readonly audit: AuditService) {}

  use(
    request: Request & { user?: AuthenticatedUser },
    response: Response,
    next: NextFunction,
  ) {
    const context = {
      requestId: randomUUID(),
      sourceIp: request.ip && isIP(request.ip) ? request.ip : null,
      request,
    };
    const startedAt = Date.now();
    response.setHeader('X-Request-Id', context.requestId);
    auditContext.run(context, () => {
      response.once('finish', () => {
        const route =
          (request.route as { path?: string } | undefined)?.path ?? 'unmatched';
        const status = response.statusCode;
        const authAction =
          request.method === 'POST' &&
          /\/auth\/(login|logout|forgot-password|reset-password|change-password)\/?$/.test(
            route,
          );
        const adminAction =
          route.includes('/admin/') && request.user?.role === UserRole.Admin;
        if (
          !authAction &&
          !adminAction &&
          ![401, 403, 429].includes(status) &&
          status < 500
        )
          return;
        const state = context as ReturnType<typeof auditContext.getStore>;
        const action = authAction
          ? `AUTH_${route.split('/').filter(Boolean).at(-1)!.replace(/-/g, '_').toUpperCase()}_${status < 400 ? 'SUCCESS' : 'FAILED'}`
          : status === 401
            ? 'AUTHENTICATION_REJECTED'
            : status === 403
              ? 'ACCESS_DENIED'
              : status === 429
                ? 'RATE_LIMIT_EXCEEDED'
                : status >= 500
                  ? 'HTTP_SERVER_ERROR'
                  : 'ADMIN_REQUEST';
        void this.audit.record({
          action,
          entityType: 'http',
          entityId: null,
          actorUserId: request.user?.id ?? state?.actorUserId ?? null,
          requestId: context.requestId,
          sourceIp: context.sourceIp,
          service: 'backend',
          severity:
            status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
          changes: {
            method: request.method,
            route,
            statusCode: status,
            durationMs: Date.now() - startedAt,
            reason: state?.securityReason ?? null,
          },
        });
      });
      next();
    });
  }
}
