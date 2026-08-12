import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, FindOperator } from 'typeorm';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuthSession } from '../../auth/entities/auth-session.entity';
import { UserSchool } from '../../users/entities/user-school.entity';
import { School } from '../entities/school.entity';
import { SchoolsService } from './schools.service';

type ManagerMock = {
  getRepository: jest.Mock;
  find: jest.Mock;
  update: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
};

const actor = { id: 'admin-id' } as never;

function savedAudit(manager: ManagerMock) {
  const call = (manager.save.mock.calls as Array<[unknown, unknown]>).find(
    ([entity]) => entity === AuditLog,
  );
  return call?.[1] as
    | {
        actorUserId: string;
        action: string;
        entityId: string;
        changes: Record<string, unknown>;
      }
    | undefined;
}

function fixture({
  isActive,
  assignments = [{ userId: 'school-user-id' }],
  affected = 2,
}: {
  isActive: boolean;
  assignments?: Array<{ userId: string }>;
  affected?: number;
}) {
  const school = { id: 'school-id', isActive } as School;
  const schoolRepository = {
    findOne: jest.fn().mockResolvedValue(school),
  };
  const manager: ManagerMock = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === School) return schoolRepository;
      throw new Error('Repositorio inesperado en la prueba.');
    }),
    find: jest.fn().mockResolvedValue(assignments),
    update: jest.fn().mockResolvedValue({ affected }),
    save: jest.fn((_entity: unknown, value: unknown) => Promise.resolve(value)),
    delete: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  } as unknown as DataSource;
  const service = new SchoolsService(dataSource);
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: school.id } as never);
  return { manager, school, schoolRepository, service };
}

describe('SchoolsService school deactivation', () => {
  it('desactiva, revoca las sesiones vigentes y audita la cantidad sin borrar asociaciones', async () => {
    const { manager, school, schoolRepository, service } = fixture({
      isActive: true,
    });

    await service.setStatus(school.id, false, actor);

    expect(schoolRepository.findOne).toHaveBeenCalledWith({
      where: { id: school.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.find).toHaveBeenCalledWith(UserSchool, {
      select: { userId: true },
      where: { schoolId: school.id },
    });
    expect(manager.update).toHaveBeenCalledTimes(1);
    const [entity, criteria, values] = manager.update.mock.calls[0] as [
      unknown,
      {
        userId: FindOperator<string>;
        revokedAt: FindOperator<null>;
        expiresAt: FindOperator<Date>;
      },
      { revokedAt: Date },
    ];
    expect(entity).toBe(AuthSession);
    expect(criteria.userId.type).toBe('in');
    expect(criteria.userId.value).toEqual(['school-user-id']);
    expect(criteria.revokedAt.type).toBe('isNull');
    expect(criteria.expiresAt.type).toBe('moreThan');
    expect(criteria.expiresAt.value).toBe(values.revokedAt);
    expect(school.isActive).toBe(false);
    expect(manager.save).toHaveBeenCalledWith(School, school);
    expect(savedAudit(manager)).toMatchObject({
      actorUserId: 'admin-id',
      action: 'SCHOOL_DEACTIVATED',
      entityId: school.id,
      changes: { revokedSessionsCount: 2 },
    });
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('reconcilia sesiones en una segunda baja sin duplicar el cambio de estado', async () => {
    const { manager, school, service } = fixture({
      isActive: false,
      affected: 1,
    });

    await service.setStatus(school.id, false, actor);

    expect(manager.update).toHaveBeenCalledTimes(1);
    const [entity, , values] = manager.update.mock.calls[0] as [
      unknown,
      unknown,
      { revokedAt: Date },
    ];
    expect(entity).toBe(AuthSession);
    expect(values.revokedAt).toBeInstanceOf(Date);
    expect(manager.save).not.toHaveBeenCalledWith(School, expect.anything());
    expect(savedAudit(manager)).toMatchObject({
      action: 'SCHOOL_SESSIONS_REVOKED',
      entityId: school.id,
      changes: {
        isActive: { from: false, to: false },
        newEvaluationsAllowed: false,
        revokedSessionsCount: 1,
      },
    });
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('no duplica auditoría cuando la baja ya estaba conciliada', async () => {
    const { manager, school, service } = fixture({
      isActive: false,
      affected: 0,
    });

    await service.setStatus(school.id, false, actor);

    expect(manager.update).toHaveBeenCalledTimes(1);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('reactiva cerrando sesiones legadas sin revivir ningún SID anterior', async () => {
    const { manager, school, service } = fixture({ isActive: false });

    await service.setStatus(school.id, true, actor);

    expect(manager.find).toHaveBeenCalledWith(UserSchool, {
      select: { userId: true },
      where: { schoolId: school.id },
    });
    expect(manager.update).toHaveBeenCalledTimes(1);
    expect(school.isActive).toBe(true);
    expect(savedAudit(manager)).toMatchObject({
      action: 'SCHOOL_ACTIVATED',
      changes: { revokedSessionsCount: 2 },
    });
  });

  it('mantiene active→active como un no-op y no cierra sesiones legítimas', async () => {
    const { manager, school, service } = fixture({ isActive: true });

    await service.setStatus(school.id, true, actor);

    expect(manager.find).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe('SchoolsService evaluation activity lock', () => {
  it('mantiene un bloqueo de lectura sobre la escuela durante la transacción', async () => {
    const school = { id: 'school-id', isActive: true } as School;
    const findOne = jest.fn().mockResolvedValue(school);
    const manager = {
      queryRunner: { isTransactionActive: true },
      getRepository: jest.fn(() => ({ findOne })),
    } as unknown as EntityManager;

    await expect(
      new SchoolsService({} as DataSource).assertActiveForEvaluation(
        school.id,
        manager,
      ),
    ).resolves.toBe(school);
    expect(findOne).toHaveBeenCalledWith({
      where: { id: school.id },
      lock: { mode: 'pessimistic_read' },
    });
  });

  it('rechaza la escuela inactiva después de adquirir el mismo bloqueo', async () => {
    const school = { id: 'school-id', isActive: false } as School;
    const findOne = jest.fn().mockResolvedValue(school);
    const manager = {
      queryRunner: { isTransactionActive: true },
      getRepository: jest.fn(() => ({ findOne })),
    } as unknown as EntityManager;

    await expect(
      new SchoolsService({} as DataSource).assertActiveForEvaluation(
        school.id,
        manager,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(findOne).toHaveBeenCalledWith({
      where: { id: school.id },
      lock: { mode: 'pessimistic_read' },
    });
  });
});
