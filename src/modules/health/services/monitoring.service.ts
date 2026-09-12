import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { MailService } from '../../mail/services/mail.service';
import { UserRole } from '../../users/entities/user-role.enum';
import { User } from '../../users/entities/user.entity';

type NotificationStatus = 'none' | 'sent' | 'failed' | 'unconfigured';

type InternalHealthState = {
  checkedAt: Date;
  database: boolean;
  frontend: boolean;
  smtpConfigured: boolean;
  recipientCount: number;
  notificationStatus: NotificationStatus;
  lastNotificationAt: Date | null;
};

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private state: InternalHealthState | null = null;
  private previousHealthy: boolean | null = null;
  private checking: Promise<InternalHealthState> | null = null;
  private initialCheckTimer: NodeJS.Timeout | null = null;
  private cachedAdminEmails: string[] = [];

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.initialCheckTimer = setTimeout(() => void this.checkNow(), 0);
  }

  onModuleDestroy() {
    if (this.initialCheckTimer) clearTimeout(this.initialCheckTimer);
  }

  @Interval(60_000)
  async scheduledCheck() {
    await this.checkNow();
  }

  async status() {
    const startedAt = Date.now();
    const latest = await this.checkNow();
    const protection = await this.auditProtectionStatus();

    return {
      timestamp: new Date().toISOString(),
      api: 'ok',
      database: latest.database ? 'ok' : 'degraded',
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      monitoring: {
        mode: 'internal',
        status: latest.database && latest.frontend ? 'ok' : 'degraded',
        latest,
      },
      alerts: {
        responsible: 'Todos los administradores activos',
        channel: 'email',
        ready: latest.smtpConfigured && latest.recipientCount > 0,
        notifiedEvents: [
          'Bloqueo automático de una cuenta por intentos fallidos',
          'Bloqueo de un usuario realizado por un administrador',
          'Caída de la base de datos o de la aplicación web',
          'Recuperación del servicio después de una caída',
        ],
      },
      retention: {
        minimumDays: 365,
        purge: 'Solo mantenimiento autorizado; nunca desde la aplicación',
        protected: protection.triggers === 2 && !protection.privileged,
        triggersInstalled: protection.triggers === 2,
        runtimePrivileged: protection.privileged,
      },
      auditWriter: this.audit.getWriterStatus(),
    };
  }

  private checkNow(): Promise<InternalHealthState> {
    if (this.checking) return this.checking;
    this.checking = this.performCheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async performCheck(): Promise<InternalHealthState> {
    const [database, frontend] = await Promise.all([
      this.checkDatabase(),
      this.checkFrontend(),
    ]);
    if (database) await this.refreshAdminRecipients();

    const healthy = database && frontend;
    let notificationStatus: NotificationStatus =
      this.state?.notificationStatus ?? 'none';
    let lastNotificationAt = this.state?.lastNotificationAt ?? null;

    const healthChanged = this.previousHealthy !== healthy;
    const shouldNotify =
      (healthChanged && (this.previousHealthy !== null || !healthy)) ||
      (!healthy && this.state?.notificationStatus === 'failed');

    if (shouldNotify) {
      notificationStatus = await this.notifyAdmins(healthy, {
        database,
        frontend,
      });
      if (notificationStatus === 'sent') lastNotificationAt = new Date();
    }

    if (healthChanged && (this.previousHealthy !== null || !healthy)) {
      await this.audit.record({
        action: healthy
          ? 'SERVICE_HEALTH_RECOVERED'
          : 'SERVICE_HEALTH_DEGRADED',
        entityType: 'service-health',
        actorUserId: null,
        entityId: null,
        service: 'backend',
        severity: healthy ? 'info' : 'error',
        changes: { database, frontend, monitoringMode: 'internal' },
      });
    }

    this.previousHealthy = healthy;
    this.state = {
      checkedAt: new Date(),
      database,
      frontend,
      smtpConfigured: this.mail.isConfigured(),
      recipientCount: this.cachedAdminEmails.length,
      notificationStatus,
      lastNotificationAt,
    };
    return this.state;
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.db.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async checkFrontend(): Promise<boolean> {
    try {
      const response = await fetch(
        this.config.getOrThrow<string>('FRONTEND_URL'),
        {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(5_000),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  private async refreshAdminRecipients(): Promise<void> {
    try {
      const admins = await this.db.getRepository(User).find({
        where: { role: UserRole.Admin, isActive: true },
        select: { email: true },
      });
      this.cachedAdminEmails = admins.map((admin) => admin.email);
    } catch {
      // Conserva la ultima lista conocida para alertar durante una falla.
    }
  }

  private async notifyAdmins(
    healthy: boolean,
    services: { database: boolean; frontend: boolean },
  ): Promise<NotificationStatus> {
    if (!this.mail.isConfigured()) return 'unconfigured';
    if (this.cachedAdminEmails.length === 0) return 'none';

    const deliveries = await Promise.allSettled(
      this.cachedAdminEmails.map((email) =>
        this.mail.sendServiceHealthAlert(email, healthy, services),
      ),
    );
    const sent = deliveries.filter(
      (delivery) => delivery.status === 'fulfilled',
    ).length;
    if (sent === 0) {
      this.logger.error(
        'No se pudo enviar la alerta de salud a los administradores.',
      );
      return 'failed';
    }
    return 'sent';
  }

  private async auditProtectionStatus(): Promise<{
    privileged: boolean;
    triggers: number;
  }> {
    try {
      const [protection] = await this.db.query<
        Array<{ privileged: boolean; triggers: number }>
      >(`SELECT
        (r.rolsuper OR r.rolcreaterole OR c.relowner = r.oid OR pg_has_role(current_user, c.relowner, 'MEMBER')
          OR has_parameter_privilege(current_user, 'session_replication_role', 'SET')) AS privileged,
        (SELECT count(*)::int FROM pg_trigger WHERE tgrelid = c.oid
          AND tgname IN ('audit_logs_immutable', 'audit_logs_no_truncate') AND tgenabled = 'O') AS triggers
        FROM pg_roles r JOIN pg_class c ON c.oid = 'audit_logs'::regclass WHERE r.rolname = current_user`);
      return protection ?? { privileged: true, triggers: 0 };
    } catch {
      return { privileged: true, triggers: 0 };
    }
  }
}
