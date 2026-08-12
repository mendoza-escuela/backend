import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { CampaignStatus } from '../entities/campaign-status.enum';
import {
  CampaignSchool,
  CampaignSchoolAssignmentSource,
} from '../entities/campaign-school.entity';
import { CampaignSchoolsService } from './campaign-schools.service';

describe('CampaignSchoolsService', () => {
  const schoolIds = [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
  ];
  const campaignId = '20000000-0000-4000-8000-000000000001';
  const actor: AuthenticatedUser = {
    id: '30000000-0000-4000-8000-000000000001',
    email: 'admin@example.com',
    role: UserRole.Admin,
    mustChangePassword: false,
  };
  const manager = {
    queryRunner: {},
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    find: jest.fn(),
    getRepository: jest.fn(),
    create: jest.fn(
      (_entity: unknown, attributes: Record<string, unknown>) => attributes,
    ),
    save: jest.fn((_entity: unknown, values: unknown) =>
      Promise.resolve(values),
    ),
  };
  const summaryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };
  const schoolBuilder = {
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };
  const assignedBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };
  const repositories = {
    campaignSchools: {
      find: jest.fn(),
      createQueryBuilder: jest.fn(() => summaryBuilder),
    },
    schools: {
      find: jest.fn(),
      createQueryBuilder: jest.fn(() => schoolBuilder),
    },
  };
  const dataSource = {
    manager,
    transaction: jest.fn(
      (callback: (transactionManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
    getRepository: jest.fn((entity: unknown) =>
      entity === CampaignSchool
        ? repositories.campaignSchools
        : repositories.schools,
    ),
  };
  let service: CampaignSchoolsService;

  beforeEach(() => {
    jest.clearAllMocks();
    summaryBuilder.getRawOne.mockResolvedValue({ assigned: '2', removed: '0' });
    repositories.campaignSchools.createQueryBuilder.mockReturnValue(
      summaryBuilder,
    );
    repositories.campaignSchools.find.mockResolvedValue([]);
    repositories.schools.find.mockResolvedValue(
      schoolIds.map((id) => ({ id, isActive: true })),
    );
    repositories.schools.createQueryBuilder.mockReturnValue(schoolBuilder);
    schoolBuilder.getRawMany.mockResolvedValue(schoolIds.map((id) => ({ id })));
    manager.getRepository.mockImplementation((entity: unknown) =>
      entity === School ? repositories.schools : repositories.campaignSchools,
    );
    manager.findOneBy.mockResolvedValue({ id: campaignId });
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Draft,
      endsAt: new Date('2099-12-31T02:59:59.999Z'),
    });
    manager.find.mockResolvedValue([]);
    service = new CampaignSchoolsService(dataSource as unknown as DataSource);
  });

  it('compone la paginación con un alias seleccionable para el orden por nombre', async () => {
    const assignments = [
      {
        id: '40000000-0000-4000-8000-000000000001',
        assignedAt: new Date('2026-08-01T12:00:00.000Z'),
        assignmentSource: CampaignSchoolAssignmentSource.Manual,
        school: { id: schoolIds[0], cue: '100', name: 'Álamo' },
      },
    ];
    repositories.campaignSchools.createQueryBuilder.mockReturnValueOnce(
      assignedBuilder,
    );
    assignedBuilder.getManyAndCount.mockResolvedValueOnce([assignments, 21]);

    const response = await service.list(campaignId, {
      page: 2,
      limit: 20,
    });

    expect(assignedBuilder.addSelect).toHaveBeenCalledWith(
      'LOWER(school.name)',
      'school_name_sort',
    );
    expect(assignedBuilder.select.mock.invocationCallOrder[0]).toBeLessThan(
      assignedBuilder.addSelect.mock.invocationCallOrder[0],
    );
    expect(assignedBuilder.orderBy).toHaveBeenCalledWith(
      'school_name_sort',
      'ASC',
    );
    expect(assignedBuilder.addOrderBy.mock.calls).toEqual([
      ['school.cue', 'ASC'],
      ['school.id', 'ASC'],
    ]);
    expect(assignedBuilder.skip).toHaveBeenCalledWith(20);
    expect(assignedBuilder.take).toHaveBeenCalledWith(20);
    expect(response).toEqual({
      items: assignments,
      pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
    });
  });

  it('asigna manualmente, en una transacción, y registra auditoría', async () => {
    const response = await service.assign(
      campaignId,
      { source: CampaignSchoolAssignmentSource.Manual, schoolIds },
      actor,
    );

    expect(response).toEqual({
      matched: 2,
      assigned: 2,
      summary: { assigned: 2, removed: 0 },
    });
    expect(manager.save).toHaveBeenCalledWith(
      CampaignSchool,
      expect.arrayContaining([
        expect.objectContaining({
          campaignId,
          schoolId: schoolIds[0],
          assignedByUserId: actor.id,
          assignmentSource: CampaignSchoolAssignmentSource.Manual,
        }),
      ]),
    );
    const audit = manager.save.mock.calls.find(
      ([entity]) => entity === AuditLog,
    )?.[1] as
      { action: string; changes: { assignedCount: number } } | undefined;
    expect(audit?.action).toBe('CAMPAIGN_SCHOOLS_ASSIGNED');
    expect(audit?.changes.assignedCount).toBe(2);
    const savedAssignments = manager.save.mock.calls.find(
      ([entity]) => entity === CampaignSchool,
    )?.[1] as CampaignSchool[] | undefined;
    expect(savedAssignments?.[0].assignedAt).toBeInstanceOf(Date);
  });

  it('es idempotente y reactiva con trazabilidad durante una etapa activa', async () => {
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Active,
      endsAt: new Date('2099-12-31T02:59:59.999Z'),
    });
    manager.find.mockResolvedValue([
      { schoolId: schoolIds[0], removedAt: null },
      {
        id: 'assignment-2',
        schoolId: schoolIds[1],
        removedAt: new Date('2026-01-01'),
        removalReason: 'Anterior',
      },
    ]);
    repositories.schools.find
      .mockResolvedValueOnce(schoolIds.map((id) => ({ id, isActive: true })))
      .mockResolvedValueOnce([{ id: schoolIds[1], isActive: true }]);

    const response = await service.assign(
      campaignId,
      { source: CampaignSchoolAssignmentSource.Manual, schoolIds },
      actor,
    );

    expect(response.assigned).toBe(1);
    expect(manager.save).toHaveBeenCalledWith(CampaignSchool, [
      expect.objectContaining({
        id: 'assignment-2',
        removedAt: null,
        removalReason: null,
      }),
    ]);
    const audit = manager.save.mock.calls.find(
      ([entity]) => entity === AuditLog,
    )?.[1] as
      | {
          changes: {
            campaignStatus: CampaignStatus;
            alreadyAssignedCount: number;
            assignedSchoolIds: string[];
            reactivatedSchoolIds: string[];
          };
        }
      | undefined;
    expect(audit?.changes).toMatchObject({
      campaignStatus: CampaignStatus.Active,
      alreadyAssignedCount: 1,
      assignedSchoolIds: [schoolIds[1]],
      reactivatedSchoolIds: [schoolIds[1]],
    });
  });

  it('resuelve en backend todas las escuelas que coinciden con los filtros', async () => {
    const response = await service.assign(
      campaignId,
      {
        source: CampaignSchoolAssignmentSource.Filter,
        department: 'Godoy Cruz',
        isActive: true,
      },
      actor,
    );

    expect(response.matched).toBe(2);
    expect(schoolBuilder.andWhere).toHaveBeenCalledWith(
      'school.department = :department',
      { department: 'Godoy Cruz' },
    );
    expect(schoolBuilder.andWhere).toHaveBeenCalledWith(
      'school.is_active = :isActive',
      { isActive: true },
    );
  });

  it('permite una asignación masiva resuelta íntegramente en backend', async () => {
    const response = await service.assign(
      campaignId,
      { source: CampaignSchoolAssignmentSource.Bulk },
      actor,
    );

    expect(response).toMatchObject({ matched: 2, assigned: 2 });
    expect(manager.save).toHaveBeenCalledWith(
      CampaignSchool,
      expect.arrayContaining([
        expect.objectContaining({
          assignmentSource: CampaignSchoolAssignmentSource.Bulk,
        }),
      ]),
    );
  });

  it('rechaza una selección manual vacía o con UUID inexistente', async () => {
    await expect(
      service.assign(
        campaignId,
        { source: CampaignSchoolAssignmentSource.Manual, schoolIds: [] },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    repositories.schools.find.mockResolvedValueOnce([{ id: schoolIds[0] }]);
    await expect(
      service.assign(
        campaignId,
        { source: CampaignSchoolAssignmentSource.Manual, schoolIds },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('incorpora una escuela durante una etapa activa con trazabilidad', async () => {
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Active,
      endsAt: new Date('2099-12-31T02:59:59.999Z'),
    });

    const response = await service.assign(
      campaignId,
      { source: CampaignSchoolAssignmentSource.Manual, schoolIds },
      actor,
    );

    expect(response).toMatchObject({ matched: 2, assigned: 2 });
    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(repositories.schools.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_read' },
      }),
    );
    const assignmentSave = manager.save.mock.calls.find(
      ([entity]) => entity === CampaignSchool,
    )?.[1] as CampaignSchool[] | undefined;
    expect(assignmentSave).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schoolId: schoolIds[0],
          assignedByUserId: actor.id,
          assignmentSource: CampaignSchoolAssignmentSource.Manual,
        }),
      ]),
    );
    const audit = manager.save.mock.calls.find(
      ([entity]) => entity === AuditLog,
    )?.[1] as
      | {
          changes: {
            assignedAt: Date;
            campaignStatus: CampaignStatus;
            assignedSchoolIds: string[];
            reactivatedSchoolIds: string[];
          };
        }
      | undefined;
    expect(audit?.changes).toMatchObject({
      campaignStatus: CampaignStatus.Active,
      assignedSchoolIds: schoolIds,
      reactivatedSchoolIds: [],
    });
    expect(assignmentSave?.[0].assignedAt).toBeInstanceOf(Date);
    expect(audit?.changes.assignedAt).toBeInstanceOf(Date);
  });

  it('permite previsualizar una incorporación durante una etapa activa', async () => {
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Active,
      endsAt: new Date('2099-12-31T02:59:59.999Z'),
    });
    repositories.campaignSchools.find.mockResolvedValue([
      { schoolId: schoolIds[0] },
    ]);
    repositories.schools.find
      .mockResolvedValueOnce(schoolIds.map((id) => ({ id, isActive: true })))
      .mockResolvedValueOnce([{ id: schoolIds[1], isActive: true }]);

    await expect(
      service.preview(campaignId, {
        source: CampaignSchoolAssignmentSource.Manual,
        schoolIds,
      }),
    ).resolves.toEqual({
      matched: 2,
      alreadyAssigned: 1,
      willAssign: 1,
      message: 'Se asignará 1 escuela.',
    });
  });

  it('rechaza en preview una escuela inactiva nueva durante una etapa activa', async () => {
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Active,
      endsAt: new Date('2099-12-31T02:59:59.999Z'),
    });
    repositories.schools.find.mockResolvedValue(
      schoolIds.map((id, index) => ({ id, isActive: index === 0 })),
    );

    await expect(
      service.preview(campaignId, {
        source: CampaignSchoolAssignmentSource.Manual,
        schoolIds,
      }),
    ).rejects.toThrow(
      'No se pueden incorporar escuelas inactivas a una etapa activa.',
    );
  });

  it('rechaza y bloquea una escuela inactiva nueva al asignar en activa', async () => {
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Active,
      endsAt: new Date('2099-12-31T02:59:59.999Z'),
    });
    repositories.schools.find.mockResolvedValue(
      schoolIds.map((id, index) => ({ id, isActive: index === 0 })),
    );

    await expect(
      service.assign(
        campaignId,
        { source: CampaignSchoolAssignmentSource.Manual, schoolIds },
        actor,
      ),
    ).rejects.toThrow(
      'No se pueden incorporar escuelas inactivas a una etapa activa.',
    );
    expect(repositories.schools.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_read' } }),
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('mantiene idempotente una asignación vigente aunque la escuela esté inactiva', async () => {
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Active,
      endsAt: new Date('2099-12-31T02:59:59.999Z'),
    });
    repositories.schools.find.mockResolvedValue([
      { id: schoolIds[0], isActive: false },
    ]);
    manager.find.mockResolvedValue([
      { schoolId: schoolIds[0], removedAt: null },
    ]);

    await expect(
      service.assign(
        campaignId,
        {
          source: CampaignSchoolAssignmentSource.Manual,
          schoolIds: [schoolIds[0]],
        },
        actor,
      ),
    ).resolves.toMatchObject({ matched: 1, assigned: 0 });
    expect(repositories.schools.find).toHaveBeenCalledTimes(1);
  });

  it.each([CampaignStatus.Closed, CampaignStatus.Archived])(
    'rechaza incorporar escuelas cuando la etapa está %s',
    async (status) => {
      manager.findOne.mockResolvedValue({
        id: campaignId,
        status,
        endsAt: new Date('2099-12-31T02:59:59.999Z'),
      });

      await expect(
        service.assign(
          campaignId,
          { source: CampaignSchoolAssignmentSource.Manual, schoolIds },
          actor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    },
  );

  it('rechaza incorporar escuelas cuando la etapa activa ya venció', async () => {
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Active,
      endsAt: new Date('2020-01-01T02:59:59.999Z'),
    });

    await expect(
      service.assign(
        campaignId,
        { source: CampaignSchoolAssignmentSource.Manual, schoolIds },
        actor,
      ),
    ).rejects.toThrow(
      'No se pueden incorporar escuelas porque la etapa ya finalizó.',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('mantiene la baja de escuelas restringida a etapas borrador', async () => {
    manager.findOne.mockResolvedValue({
      id: campaignId,
      status: CampaignStatus.Active,
      endsAt: new Date('2099-12-31T02:59:59.999Z'),
    });

    await expect(
      service.remove(campaignId, schoolIds[0], undefined, actor),
    ).rejects.toThrow(
      'Las escuelas sólo pueden quitarse mientras la etapa está en borrador.',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('devuelve un error operativo controlado si falta la migración', async () => {
    dataSource.transaction.mockRejectedValueOnce({
      code: '42P01',
      table: 'campaign_schools',
    });

    await expect(
      service.assign(
        campaignId,
        { source: CampaignSchoolAssignmentSource.Manual, schoolIds },
        actor,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
