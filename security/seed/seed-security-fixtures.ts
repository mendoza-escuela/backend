/**
 * Datos sintéticos para el entorno efímero de pruebas de seguridad.
 *
 * Crea las cuentas que usan el DAST autenticado y los tests de control de
 * acceso. Todos los datos son ficticios y viven únicamente en la base efímera
 * levantada por compose.security.yml.
 *
 * Cuentas creadas (roles reales del sistema: admin y school):
 *   - security_admin    → rol admin
 *   - security_school   → rol school, asociado a la ESCUELA A
 *   - security_school_b → rol school, asociado a la ESCUELA B
 *
 * Las dos cuentas de escuela son el par necesario para probar acceso
 * horizontal: B nunca debe poder leer ni modificar recursos de A.
 *
 * `mustChangePassword` se deja en false a propósito: PasswordChangeRequiredGuard
 * bloquea la navegación mientras esté activo y el escáner no podría recorrer la
 * aplicación. Es una diferencia deliberada respecto del alta real de usuarios,
 * limitada exclusivamente a estos datos sintéticos efímeros.
 *
 * Ejecución:
 *   docker compose -f compose.security.yml --profile seed run --rm sec-seed
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import dataSource from '../../src/database/data-source';
import { School } from '../../src/modules/schools/entities/school.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { UserSchool } from '../../src/modules/users/entities/user-school.entity';
import { UserRole } from '../../src/modules/users/entities/user-role.enum';

const BCRYPT_ROUNDS = 12;

type SchoolFixture = {
  cue: string;
  name: string;
  department: string;
  locality: string;
};

const SCHOOL_A: SchoolFixture = {
  cue: '9900000000001',
  name: 'Escuela Sintetica de Seguridad A',
  department: 'Departamento Sintetico A',
  locality: 'Localidad Sintetica A',
};

const SCHOOL_B: SchoolFixture = {
  cue: '9900000000002',
  name: 'Escuela Sintetica de Seguridad B',
  department: 'Departamento Sintetico B',
  locality: 'Localidad Sintetica B',
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

async function upsertSchool(fixture: SchoolFixture): Promise<School> {
  const repository = dataSource.getRepository(School);
  const existing = await repository.findOneBy({ cue: fixture.cue });
  if (existing) return existing;

  return repository.save(
    repository.create({
      cue: fixture.cue,
      name: fixture.name,
      directorName: 'Director Sintetico',
      schoolNumber: null,
      department: fixture.department,
      locality: fixture.locality,
      address: 'Calle Sintetica 100',
      postalCode: '5500',
      educationLevel: 'Primaria',
      managementType: 'Estatal',
      scope: 'Urbano',
      shift: 'Mañana',
      shiftCatalogId: null,
      phone: null,
      email: null,
      referentFirstName: 'Referente',
      referentLastName: 'Sintetico',
      referentEmail: null,
      referentPhone: null,
      enrollment: 100,
      hasKiosk: true,
      hasFoodService: false,
      isBoarding: false,
      characteristics: {},
      isActive: true,
    }),
  );
}

async function upsertUser(
  email: string,
  password: string,
  role: UserRole,
  firstName: string,
): Promise<User> {
  const repository = dataSource.getRepository(User);
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await repository
    .createQueryBuilder('user')
    .where('LOWER(user.email) = :email', { email: normalizedEmail })
    .getOne();
  if (existing) return existing;

  return repository.save(
    repository.create({
      firstName,
      lastName: 'Seguridad',
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      role,
      isActive: true,
      // Ver nota de cabecera: el escáner no puede navegar con el cambio forzado.
      mustChangePassword: false,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    }),
  );
}

async function linkUserToSchool(
  userId: string,
  schoolId: string,
): Promise<void> {
  const repository = dataSource.getRepository(UserSchool);
  const existing = await repository.findOneBy({ userId });
  if (existing) return;
  await repository.save(repository.create({ userId, schoolId }));
}

async function seedSecurityFixtures(): Promise<void> {
  await dataSource.initialize();

  const admin = await upsertUser(
    requiredEnv('SECURITY_ADMIN_EMAIL'),
    requiredEnv('SECURITY_ADMIN_PASSWORD'),
    UserRole.Admin,
    'Admin',
  );

  const schoolA = await upsertSchool(SCHOOL_A);
  const schoolB = await upsertSchool(SCHOOL_B);

  const schoolUserA = await upsertUser(
    requiredEnv('SECURITY_SCHOOL_EMAIL'),
    requiredEnv('SECURITY_SCHOOL_PASSWORD'),
    UserRole.School,
    'EscuelaA',
  );
  const schoolUserB = await upsertUser(
    requiredEnv('SECURITY_SCHOOL_B_EMAIL'),
    requiredEnv('SECURITY_SCHOOL_B_PASSWORD'),
    UserRole.School,
    'EscuelaB',
  );

  await linkUserToSchool(schoolUserA.id, schoolA.id);
  await linkUserToSchool(schoolUserB.id, schoolB.id);

  // Sólo identificadores: nunca imprimir contraseñas, ni siquiera sintéticas.
  console.log(
    JSON.stringify(
      {
        adminId: admin.id,
        schoolAId: schoolA.id,
        schoolBId: schoolB.id,
        schoolUserAId: schoolUserA.id,
        schoolUserBId: schoolUserB.id,
      },
      null,
      2,
    ),
  );
  console.log('Datos sintéticos de seguridad listos.');
}

seedSecurityFixtures()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? `No se pudieron crear los datos sintéticos: ${error.message}`
        : 'No se pudieron crear los datos sintéticos.',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });
