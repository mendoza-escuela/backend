import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { MailService } from '../../mail/services/mail.service';
import { MonitoringService } from './monitoring.service';

describe('MonitoringService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('detecta una falla interna y avisa la recuperación a los administradores', async () => {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('pg_roles') ? [{ privileged: false, triggers: 2 }] : [],
      ),
    );
    const findAdmins = jest
      .fn()
      .mockResolvedValue([{ email: 'admin@example.test' }]);
    const db = {
      query,
      getRepository: () => ({ find: findAdmins }),
    } as unknown as DataSource;
    const recordAudit = jest.fn().mockResolvedValue(undefined);
    const audit = {
      record: recordAudit,
      getWriterStatus: () => ({ lastWriteFailureAt: null }),
    } as unknown as AuditService;
    const sendHealthAlert = jest.fn().mockResolvedValue(undefined);
    const mail = {
      isConfigured: () => true,
      sendServiceHealthAlert: sendHealthAlert,
    } as unknown as MailService;
    const service = new MonitoringService(
      db,
      new ConfigService({ FRONTEND_URL: 'http://frontend.test' }),
      audit,
      mail,
    );
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    const degraded = await service.status();
    const recovered = await service.status();

    expect(degraded.monitoring.status).toBe('degraded');
    expect(recovered.monitoring.status).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sendHealthAlert).toHaveBeenNthCalledWith(
      1,
      'admin@example.test',
      false,
      { database: true, frontend: false },
    );
    expect(sendHealthAlert).toHaveBeenNthCalledWith(
      2,
      'admin@example.test',
      true,
      { database: true, frontend: true },
    );
    expect(recordAudit).toHaveBeenCalledTimes(2);
  });
});
