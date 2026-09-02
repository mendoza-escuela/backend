import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../src/common/types/authenticated-user.type';
import { UserRole } from '../src/modules/users/entities/user-role.enum';
import { AdminUsersService } from '../src/modules/users/services/admin-users.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

type PersistedUser = { id: string; email: string };

describeWithDatabase(
  'Active administrator invariant serialization (PostgreSQL)',
  () => {
    const invariantLock = 'admin-users.active-administrator-invariant.v1';
    const runId = randomUUID().replaceAll('-', '');
    let dataSource: DataSource;
    let service: AdminUsersService;
    let administrators: [PersistedUser, PersistedUser];
    let previouslyActiveAdministratorIds: string[] = [];

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: databaseUrl,
        entities: [__dirname + '/../src/modules/**/*.entity{.ts,.js}'],
      });
      await dataSource.initialize();
      service = new AdminUsersService(dataSource);

      administrators = await dataSource.transaction(async (manager) => {
        const previous = await manager.query<Array<{ id: string }>>(
          `SELECT id
             FROM users
            WHERE role = 'admin' AND is_active = true`,
        );
        previouslyActiveAdministratorIds = previous.map(({ id }) => id);
        if (previouslyActiveAdministratorIds.length > 0) {
          await manager.query(
            `UPDATE users
                SET is_active = false
              WHERE id = ANY($1::uuid[])`,
            [previouslyActiveAdministratorIds],
          );
        }

        const inserted = await manager.query<PersistedUser[]>(
          `INSERT INTO users
             (first_name, last_name, email, password_hash, role, is_active,
              must_change_password)
           VALUES
             ('Admin', 'Concurrente A', $1, 'hash-de-prueba', 'admin', true, false),
             ('Admin', 'Concurrente B', $2, 'hash-de-prueba', 'admin', true, false)
           RETURNING id, email`,
          [
            `admin.invariant.a.${runId}@example.com`,
            `admin.invariant.b.${runId}@example.com`,
          ],
        );
        return inserted as [PersistedUser, PersistedUser];
      });
    }, 30_000);

    beforeEach(async () => {
      if (!dataSource?.isInitialized || !administrators) return;
      await dataSource.query(
        `UPDATE users
            SET role = 'admin', is_active = true
          WHERE id = ANY($1::uuid[])`,
        [administrators.map(({ id }) => id)],
      );
    });

    afterAll(async () => {
      try {
        if (dataSource?.isInitialized) {
          await dataSource.transaction(async (manager) => {
            if (previouslyActiveAdministratorIds.length > 0) {
              await manager.query(
                `UPDATE users
                    SET is_active = true
                  WHERE id = ANY($1::uuid[])`,
                [previouslyActiveAdministratorIds],
              );
            }
            if (!administrators) return;
            const administratorIds = administrators.map(({ id }) => id);
            await manager.query(
              `DELETE FROM audit_logs
                WHERE entity_id = ANY($1::uuid[])
                   OR actor_user_id = ANY($1::uuid[])`,
              [administratorIds],
            );
            await manager.query(
              `DELETE FROM user_schools WHERE user_id = ANY($1::uuid[])`,
              [administratorIds],
            );
            await manager.query(
              `DELETE FROM password_reset_tokens
                WHERE user_id = ANY($1::uuid[])`,
              [administratorIds],
            );
            await manager.query(
              `DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])`,
              [administratorIds],
            );
            await manager.query(
              `DELETE FROM users WHERE id = ANY($1::uuid[])`,
              [administratorIds],
            );
          });
        }
      } finally {
        if (dataSource?.isInitialized) await dataSource.destroy();
      }
    });

    it('allows only one of two concurrent status changes to remove an active administrator', async () => {
      const outcomes = await runBehindInvariantGate([
        () =>
          service.setStatus(
            administrators[0].id,
            false,
            actor(administrators[1]),
          ),
        () =>
          service.setStatus(
            administrators[1].id,
            false,
            actor(administrators[0]),
          ),
      ]);

      expectSingleRejectedMutation(outcomes);
      await expectExactlyOneActiveAdministrator();
    });

    it('shares the same lock between status changes and role demotions', async () => {
      const outcomes = await runBehindInvariantGate([
        () =>
          service.setStatus(
            administrators[0].id,
            false,
            actor(administrators[1]),
          ),
        () =>
          service.update(
            administrators[1].id,
            { role: UserRole.School, schoolId: null },
            actor(administrators[0]),
          ),
      ]);

      expectSingleRejectedMutation(outcomes);
      await expectExactlyOneActiveAdministrator();
    });

    async function runBehindInvariantGate<T>(
      operations: [() => Promise<T>, () => Promise<T>],
    ): Promise<PromiseSettledResult<T>[]> {
      const gate = dataSource.createQueryRunner();
      let pending: Promise<T>[] = [];
      await gate.connect();
      await gate.startTransaction();
      try {
        await gate.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
          [invariantLock],
        );
        pending = operations.map((operation) => operation());
        await waitForAdvisoryWaiters(2);
        await gate.commitTransaction();
        return Promise.allSettled(pending);
      } catch (error) {
        if (gate.isTransactionActive) await gate.rollbackTransaction();
        await Promise.allSettled(pending);
        throw error;
      } finally {
        await gate.release();
      }
    }

    async function waitForAdvisoryWaiters(expected: number): Promise<void> {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const [{ count }] = await dataSource.query<Array<{ count: number }>>(
          `SELECT COUNT(*)::int AS count
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND database = (SELECT oid FROM pg_database
                               WHERE datname = current_database())
              AND granted = false`,
        );
        if (count >= expected) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(
        `No se observaron ${expected} operaciones esperando el advisory lock.`,
      );
    }

    function expectSingleRejectedMutation<T>(
      outcomes: PromiseSettledResult<T>[],
    ): void {
      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = outcomes.filter(({ status }) => status === 'rejected');
      expect(rejected).toHaveLength(1);
      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      }
    }

    async function expectExactlyOneActiveAdministrator(): Promise<void> {
      const [{ count }] = await dataSource.query<Array<{ count: number }>>(
        `SELECT COUNT(*)::int AS count
           FROM users
          WHERE role = 'admin' AND is_active = true`,
      );
      expect(count).toBe(1);
    }

    function actor(user: PersistedUser): AuthenticatedUser {
      return {
        id: user.id,
        firstName: 'Admin',
        lastName: 'Concurrente',
        email: user.email,
        role: UserRole.Admin,
        sessionId: randomUUID(),
        mustChangePassword: false,
        lastLoginAt: null,
      };
    }
  },
);
