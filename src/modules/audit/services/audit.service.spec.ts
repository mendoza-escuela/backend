import { DataSource } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('entrega el nombre del responsable sin exponer la entidad de usuario', async () => {
    const event = {
      id: 'audit-id',
      createdAt: new Date('2026-09-12T12:00:00Z'),
      actorUserId: 'user-id',
      actor: {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
      },
      action: 'ADMIN_REQUEST',
      entityType: 'http',
      entityId: null,
      changes: { statusCode: 200 },
      requestId: 'request-id',
      sourceIp: '127.0.0.1',
      service: 'backend',
      severity: 'info',
    } as AuditLog;
    const builder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[event], 1]),
    };
    const dataSource = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => builder),
      })),
    } as unknown as DataSource;

    const response = await new AuditService(dataSource).list({
      page: 1,
      limit: 25,
    });

    expect(builder.leftJoinAndSelect).toHaveBeenCalledWith(
      'audit.actor',
      'actor',
    );
    expect(response.items[0]).toMatchObject({
      actorName: 'Ana Pérez',
      actorEmail: 'ana@example.com',
    });
    expect(response.items[0]).not.toHaveProperty('actor');
  });
});
