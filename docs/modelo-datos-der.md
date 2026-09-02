# Modelo de datos completo para DER

Fecha de relevamiento: 2026-08-18  
Motor: PostgreSQL  
ORM: TypeORM (`synchronize: false`, `migrationsRun: false`)

## Criterio y fuentes del relevamiento

Este documento reconstruye el modelo **actualmente implementado**, no un modelo ideal ni el listado sugerido en `AGENTS.md`. Se contrastaron las 30 clases `@Entity`, todos los enums persistidos, las 26 migraciones de `backend/src/migrations`, el seed del administrador, los datos iniciales de catálogos, servicios, consultas de dashboard/exportación, triggers y documentación funcional del backend. El frontend no define persistencia propia ni existe Prisma en el proyecto.

Para nombres físicos, índices, checks, defaults y FKs se toma como autoridad la secuencia de migraciones. Las entidades muestran la intención vigente del código. Cuando ambas fuentes difieren, se indica expresamente. No se consultó una instancia PostgreSQL desplegada; por lo tanto, “esquema actual” significa el resultado esperado de ejecutar todas las migraciones del repositorio en orden.

Convenciones:

- `N` significa muchas filas; `0..1`, relación opcional; `1`, relación obligatoria.
- `now()` es el default físico de las columnas administradas por `CreateDateColumn`/`UpdateDateColumn`; `updated_at` lo actualiza TypeORM al guardar, no un trigger general de PostgreSQL.
- Las PK UUID usan `gen_random_uuid()` o `uuid_generate_v4()` según la migración concreta.
- “Relación inferida” es una dependencia que usa el código pero que PostgreSQL no protege mediante FK.
- No hay columnas `deleted_at`. Los pseudo-soft-deletes existentes se explican por tabla.

# 1. Resumen general del modelo

La base se divide en siete dominios:

1. **Identidad y seguridad:** usuarios, relación usuario-escuela, sesiones JWT revocables y tokens de recuperación.
2. **Escuelas:** padrón actual, contactos, catálogos, niveles educativos, rectificaciones históricas y cambios de asignación de cuentas.
3. **Cuestionarios versionados:** instrumento, versiones, dimensiones, secciones, preguntas, opciones y reglas de aplicabilidad.
4. **Campañas:** etapas temporales que fijan una versión del cuestionario y un universo explícito de escuelas.
5. **Presentaciones:** borrador/envío, respuestas y decisiones de aplicabilidad congeladas.
6. **Evaluación:** configuración versionada, rangos de estrellas, resultado general y resultados por dimensión.
7. **Auditoría:** bitácora polimórfica de acciones relevantes.

Los ejes centrales son `schools`, `survey_versions`, `campaigns` y `survey_submissions`. El sistema conserva historia por versionado e instantáneas JSONB: una presentación guarda la ficha escolar y el respondente originales; una evaluación guarda además un snapshot reproducible del instrumento, respuestas, reglas y cálculo.

No existen tablas de archivos o documentos. CSV, XLSX y PDF se importan/generan en memoria; no se persisten como blobs ni rutas.

TypeORM crea normalmente su tabla técnica de control `migrations` al ejecutar el CLI. No está declarada como entidad ni creada por una migración del proyecto y no representa datos de negocio; por eso no integra las 30 entidades ni debe incluirse en el DER funcional. Su presencia y nombre efectivos deben confirmarse en cada base desplegada.

## Enums y dominios cerrados

| Dominio | Valores |
|---|---|
| `users.role` | `admin`, `school` |
| `survey_versions.status` | `draft`, `published`, `archived` |
| `survey_questions.type` | `single_choice`, `multiple_choice`, `boolean`, `short_text`, `long_text`, `number`, `date` |
| `campaigns.type` | `annual`, `semiannual` |
| `campaigns.status` | `draft`, `active`, `closed`, `archived` |
| `campaign_schools.assignment_source` | `manual`, `filter`, `bulk` |
| `school_contacts.type` | `RESPONDENT`, `HEALTH_PROMOTION` |
| `survey_submissions.status` | `draft`, `submitted` |
| `evaluation_configurations.status` | `draft`, `active`, `archived` |
| `school_user_assignment_history.action` | `assigned`, `replaced`, `unassigned` (varchar + CHECK, no enum PostgreSQL) |
| `survey_applicability_rules.group_operator` | `all`, `any` (varchar + CHECK) |
| `survey_applicability_rules.action/default_action` | `show`, `omit` (varchar + CHECK) |
| `submission_question_applicability.status` | `applicable`, `excluded`, `incomplete` (varchar + CHECK) |
| `submission_question_applicability.reason_code` | `NO_APPLICABILITY_RULES`, `MATCHED_SHOW_RULE`, `MATCHED_EXCLUSION_RULE`, `DEFAULT_SHOW`, `DEFAULT_EXCLUSION`, `MISSING_SCHOOL_DATA`, `DATA_CORRECTION_KIOSK_NOT_APPLICABLE` (solo TypeScript; sin CHECK) |
| `evaluation_results.calculation_source` | `submission_finalization`, `single_recalculation`, `system` (solo TypeScript; sin CHECK) |

`SurveyVersionTemplate` (`blank`, `official_dimensions`) existe como opción de API, pero **no es una columna ni un enum persistido**.

# 2. Entidades

## USERS

Descripción: cuenta de acceso. Almacena identidad, rol y estado de seguridad; la contraseña solo se guarda hasheada y TypeORM excluye `password_hash` de selecciones normales.

Campos:

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Identificador de cuenta. |
| `first_name` | varchar(100) | No | — | No | No | No | Nombre. |
| `last_name` | varchar(100) | No | — | No | No | No | Apellido. |
| `email` | varchar(255) | No | — | No | No | Sí, `LOWER(email)` | Identificador de login, único sin distinguir mayúsculas. |
| `password_hash` | varchar(255) | No | — | No | No | No | Hash bcrypt; nunca contraseña plana. |
| `role` | `users_role_enum` | No | `school` | No | No | No | `admin` o `school`. |
| `is_active` | boolean | No | `true` | No | No | No | Baja lógica de la cuenta. |
| `must_change_password` | boolean | No | `true` | No | No | No | Obliga cambio en próximo acceso. |
| `last_login_at` | timestamptz | Sí | `NULL` | No | No | No | Último login exitoso. |
| `failed_login_attempts` | integer | No | `0` | No | No | No | Contador de intentos fallidos. |
| `locked_until` | timestamptz | Sí | `NULL` | No | No | No | Bloqueo temporal. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Última modificación. |

Relaciones:

- `users.id` ← `user_schools.user_id`: 1 → 0..1 en el esquema actual; `user_schools` es dependiente.
- `users.id` ← sesiones, tokens y numerosas columnas de actor: 1 → N.

Reglas/observaciones: índices físicos `IDX_users_email_unique` (único funcional sobre `LOWER(email)`), `IDX_users_role_active`, B-tree funcional por apellido/nombre y GIN trigram por nombre, apellido y email. Soft delete mediante `is_active`, no `deleted_at`. El seed inicial normaliza el email a minúsculas, crea rol `admin` y exige cambio de contraseña.

## USER_SCHOOLS

Descripción: asociación vigente entre una cuenta escolar y un establecimiento. Aunque su forma es de tabla puente, dos índices únicos la convierten en una relación 1:1 opcional en ambos sentidos.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `user_id` | uuid | No | — | Sí, compuesta | `users.id` | Sí | Cuenta asignada. |
| `school_id` | uuid | No | — | Sí, compuesta | `schools.id` | Sí | Escuela asignada. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Inicio del vínculo vigente. |

Relaciones: `USERS 0..1 ↔ 0..1 SCHOOLS`, implementada por `USER_SCHOOLS`; ambas FKs usan `ON DELETE CASCADE`.

Reglas/observaciones: PK (`user_id`,`school_id`); únicos `IDX_user_schools_one_school_per_user(user_id)` y `IDX_user_schools_one_user_per_school(school_id)`. El índice no único inicial `IDX_user_schools_school(school_id)` queda redundante después del único. Los cambios históricos viven aparte en `school_user_assignment_history`.

## AUTH_SESSIONS

Descripción: sesiones JWT revocables; `token_id` corresponde al identificador único (`jti`) del token.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Identificador. |
| `token_id` | uuid | No | — | No | No | Sí | JTI del JWT. |
| `user_id` | uuid | No | — | No | `users.id` | No | Titular. |
| `expires_at` | timestamptz | No | — | No | No | No | Vencimiento. |
| `revoked_at` | timestamptz | Sí | `NULL` | No | No | No | Revocación lógica. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Creación. |

Relaciones: `USERS 1 → N AUTH_SESSIONS`; dependiente `auth_sessions`, `ON DELETE CASCADE`.

Reglas/observaciones: índices `IDX_auth_sessions_token_id` único y `IDX_auth_sessions_user_active(user_id, revoked_at, expires_at)`. La revocación es un estado histórico, no soft delete formal.

## PASSWORD_RESET_TOKENS

Descripción: tokens de recuperación de contraseña de un solo uso. Persiste SHA-256 del secreto, nunca el token en claro.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Identificador. |
| `token_hash` | varchar(64) | No | — | No | No | Sí | Hash hexadecimal SHA-256. |
| `user_id` | uuid | No | — | No | `users.id` | No | Usuario destinatario. |
| `expires_at` | timestamptz | No | — | No | No | No | Vencimiento. |
| `used_at` | timestamptz | Sí | `NULL` | No | No | No | Marca uso único. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Emisión. |

Relaciones: `USERS 1 → N PASSWORD_RESET_TOKENS`; dependiente con `ON DELETE CASCADE`.

Reglas/observaciones: índices `IDX_password_reset_tokens_hash` único y `IDX_password_reset_tokens_user(user_id, used_at, expires_at)`.

## AUDIT_LOGS

Descripción: auditoría transversal de acciones funcionales y de seguridad.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Evento. |
| `actor_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Actor; puede perderse si se elimina la cuenta. |
| `action` | varchar(80) | No | — | No | No | No | Código de acción. |
| `entity_type` | varchar(80) | No | — | No | No | No | Tipo lógico afectado. |
| `entity_id` | uuid | Sí | `NULL` | No | No | No | ID lógico afectado. |
| `changes` | jsonb | No | `{}` | No | No | No | Antes/después o metadatos de la acción. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Momento. |

Relaciones: `USERS 1 → N AUDIT_LOGS` por actor, `ON DELETE SET NULL`. **Relación inferida polimórfica:** (`entity_type`,`entity_id`) apunta lógicamente a `User`, `School`, `Campaign`, `CampaignSchool`, `SurveySubmission`, `EvaluationResult`, `EvaluationConfiguration`, etc., pero no existe FK posible ni catálogo cerrado.

Reglas/observaciones: índices físicos `IDX_audit_logs_actor(actor_user_id)` y `IDX_audit_logs_entity(entity_id, created_at)`. No hay `updated_at`; los eventos se tratan como append-only desde servicios, pero no existe trigger que impida UPDATE/DELETE.

## SCHOOLS

Descripción: padrón y estado **actual** de cada establecimiento.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Escuela. |
| `cue` | varchar(50) | No | — | No | No | Sí | Código único del establecimiento. |
| `name` | varchar(255) | No | — | No | No | No | Nombre. |
| `director_name` | varchar(200) | No | — | No | No | No | Dirección actual. |
| `school_number` | varchar(30) | Sí | `NULL` | No | No | No | Número escolar. |
| `department` | varchar(120) | No | — | No | No | No | Departamento. |
| `locality` | varchar(120) | No | — | No | No | No | Localidad. |
| `address` | varchar(255) | No | — | No | No | No | Domicilio. |
| `postal_code` | varchar(20) | Sí | `NULL` | No | No | No | CP. |
| `education_level` | varchar(120) | No | — | No | No | No | Campo legado/desnormalizado de nivel. |
| `management_type` | varchar(120) | No | — | No | No | No | Tipo de gestión/sector. |
| `scope` | varchar(120) | No | — | No | No | No | Ámbito. |
| `shift` | varchar(120) | No | — | No | No | No | Campo legado/desnormalizado de jornada. |
| `shift_catalog_id` | uuid | Sí | `NULL` | No | `school_shift_catalogs.id` | No | Jornada estructurada actual. |
| `phone` | varchar(40) | Sí | `NULL` | No | No | No | Teléfono institucional. |
| `email` | varchar(255) | Sí | `NULL` | No | No | No | Email institucional. |
| `referent_first_name` | varchar(100) | No | — | No | No | No | Referente legado/desnormalizado. |
| `referent_last_name` | varchar(100) | No | — | No | No | No | Referente legado/desnormalizado. |
| `referent_email` | varchar(255) | Sí | `NULL` | No | No | No | Email legado del referente. |
| `referent_phone` | varchar(40) | Sí | `NULL` | No | No | No | Teléfono legado del referente. |
| `enrollment` | integer | Sí | `NULL` | No | No | No | Matrícula total; 0..1.000.000. |
| `has_kiosk` | boolean | Sí | `NULL` | No | No | No | Ternario: sí/no/desconocido. |
| `has_food_service` | boolean | Sí | `NULL` | No | No | No | Comedor/servicio alimentario. |
| `is_boarding` | boolean | Sí | `NULL` | No | No | No | Albergue. |
| `characteristics` | jsonb | No | `{}` | No | No | No | Extensiones/legado de características. |
| `is_active` | boolean | No | `true` | No | No | No | Baja lógica institucional. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: catálogo de jornada 1 → N escuelas; escuela 1 → N contactos, niveles actuales, rectificaciones, asignaciones históricas, asignaciones a campañas, presentaciones y resultados. Usuario escolar ↔ escuela es 1:1 opcional vía `user_schools`.

Reglas/observaciones: `CHK_schools_enrollment`; FK jornada `ON DELETE RESTRICT`. Índices por CUE único (el nombre físico histórico sigue siendo `IDX_schools_code_unique`), número, departamento, localidad, nivel, gestión, activo, (`created_at`,`id`) y GIN trigram sobre nombre/CUE/número. `is_active` es soft delete. Los campos texto `shift`, `education_level` y `referent_*` coexisten con las estructuras nuevas y constituyen duplicación de transición.

## SCHOOL_SHIFT_CATALOGS

Descripción: catálogo versionable de jornadas.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Jornada. |
| `code` | varchar(80) | No | — | No | No | Sí | Código estable. |
| `label` | varchar(160) | No | — | No | No | No | Etiqueta. |
| `is_active` | boolean | No | `true` | No | No | No | Disponibilidad lógica. |
| `order` | integer | No | `0` | No | No | No | Orden, >= 0. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: `SCHOOL_SHIFT_CATALOGS 1 → N SCHOOLS`; escuela dependiente y FK opcional `ON DELETE RESTRICT`.

Reglas/observaciones: único por `code`; índice (`is_active`,`order`); CHECK orden. Seed oficial: `simple`, `extendida`, `completa_frontera`, `completa_albergue`, `ampliacion_primaria_convenio_nacion`, `fortalecimiento_trayectorias`.

## EDUCATION_LEVEL_CATALOGS

Descripción: catálogo de niveles educativos.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Nivel. |
| `code` | varchar(80) | No | — | No | No | Sí | Código estable. |
| `label` | varchar(160) | No | — | No | No | No | Etiqueta. |
| `is_active` | boolean | No | `true` | No | No | No | Disponibilidad. |
| `order` | integer | No | `0` | No | No | No | Orden >= 0. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: 1 → N con `school_education_levels` y 1 → N con `school_rectification_education_levels`, ambas dependientes; borrado `RESTRICT`.

Reglas/observaciones: único por `code`; índice (`is_active`,`order`); seed: `inicial`, `primario`, `secundario`, `superior`.

## SCHOOL_EDUCATION_LEVELS

Descripción: tabla intermedia que implementa la relación N:M actual entre escuelas y niveles; agrega matrícula y orden.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Fila. |
| `school_id` | uuid | No | — | No | `schools.id` | Compuesta | Escuela. |
| `level_id` | uuid | No | — | No | `education_level_catalogs.id` | Compuesta | Nivel. |
| `enrollment` | integer | Sí | `NULL` | No | No | No | Matrícula del nivel, 0..1.000.000. |
| `order` | integer | No | — | No | No | Compuesta | Orden >= 0. |

Relaciones: `SCHOOLS N ↔ N EDUCATION_LEVEL_CATALOGS` mediante esta tabla. Escuela 1 → N filas (`CASCADE`); nivel 1 → N filas (`RESTRICT`).

Reglas/observaciones: únicos (`school_id`,`level_id`) y (`school_id`,`order`); checks matrícula y orden.

## SCHOOL_CONTACTS

Descripción: contactos estructurados actuales de una escuela.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Contacto. |
| `school_id` | uuid | No | — | No | `schools.id` | Compuesta | Escuela. |
| `type` | `school_contacts_type_enum` | No | — | No | No | Compuesta | `RESPONDENT` o `HEALTH_PROMOTION`. |
| `first_name` | varchar(100) | No | — | No | No | No | Nombre. |
| `last_name` | varchar(100) | No | — | No | No | No | Apellido. |
| `position` | varchar(160) | Sí | `NULL` | No | No | No | Cargo. |
| `phone` | varchar(40) | Sí | `NULL` | No | No | No | Teléfono. |
| `email` | varchar(255) | Sí | `NULL` | No | No | No | Email. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: `SCHOOLS 1 → 0..2 SCHOOL_CONTACTS`; dependiente `ON DELETE CASCADE`.

Reglas/observaciones: único (`school_id`,`type`) limita a un contacto de cada tipo. La migración inicial copia el referente legado como `RESPONDENT`.

## SCHOOL_RECTIFICATIONS

Descripción: confirmaciones/rectificaciones históricas inmutables de la ficha escolar para un período.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Rectificación. |
| `school_id` | uuid | No | — | No | `schools.id` | No | Escuela. |
| `period_year` | integer | No | — | No | No | No | Año 2000..2200. |
| `actor_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Usuario confirmante. |
| `snapshot` | jsonb | No | — | No | No | No | Copia autocontenida de la ficha. |
| `rectified_at` | timestamptz | No | `now()` | No | No | No | Fecha de confirmación. |

Relaciones: escuela 1 → N rectificaciones (`CASCADE`); usuario 1 → N como actor (`SET NULL`); rectificación 1 → N niveles históricos.

Reglas/observaciones: CHECK período; índice (`school_id`,`period_year`,`rectified_at`). No existe único escuela/año: varias confirmaciones anuales son válidas. Trigger impide UPDATE y DELETE. `snapshot` contiene, según su tipo TS: versión/origen/fecha, identidad y ubicación, dirección, contactos, jornada, niveles, matrículas, tres características ternarias y extensiones.

## SCHOOL_RECTIFICATION_EDUCATION_LEVELS

Descripción: detalle histórico estructurado de niveles incluido en una rectificación. Duplica código/etiqueta para no reinterpretar el pasado si cambia el catálogo.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Fila histórica. |
| `rectification_id` | uuid | No | — | No | `school_rectifications.id` | Compuesta | Rectificación. |
| `level_id` | uuid | No | — | No | `education_level_catalogs.id` | Compuesta | Nivel de origen. |
| `level_code` | varchar(80) | No | — | No | No | No | Código congelado. |
| `level_label` | varchar(160) | No | — | No | No | No | Etiqueta congelada. |
| `enrollment` | integer | Sí | `NULL` | No | No | No | Matrícula histórica. |
| `order` | integer | No | — | No | No | Compuesta | Orden histórico. |

Relaciones: rectificación 1 → N filas (`CASCADE`); catálogo 1 → N filas (`RESTRICT`). Es una asociación histórica N:M enriquecida.

Reglas/observaciones: únicos (`rectification_id`,`level_id`) y (`rectification_id`,`order`); checks matrícula/orden; trigger impide UPDATE y DELETE.

## SCHOOL_USER_ASSIGNMENT_HISTORY

Descripción: historial de asignación, reemplazo y desasignación de cuentas escolares.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Evento. |
| `school_id` | uuid | No | — | No | `schools.id` | No | Escuela. |
| `previous_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Cuenta anterior. |
| `new_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Cuenta nueva. |
| `actor_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Administrador actor. |
| `action` | varchar(20) | No | — | No | No | No | `assigned`, `replaced`, `unassigned`. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Momento. |

Relaciones: escuela 1 → N eventos (`CASCADE`); cada rol de usuario 1 → N eventos (`SET NULL`).

Reglas/observaciones: CHECK de acción; índice físico (`school_id`,`created_at`). Es histórico append-only por uso, pero sin trigger de inmutabilidad.

## SURVEYS

Descripción: definición estable de un cuestionario; sus cambios estructurales viven en versiones.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Instrumento. |
| `code` | varchar(80) | No | — | No | No | Sí | Código funcional. |
| `name` | varchar(255) | No | — | No | No | No | Nombre. |
| `description` | text | Sí | `NULL` | No | No | No | Descripción. |
| `is_active` | boolean | No | `true` | No | No | No | Archivado/baja lógica del instrumento. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: `SURVEYS 1 → N SURVEY_VERSIONS`; versión dependiente, FK `ON DELETE RESTRICT`.

Reglas/observaciones: único `UQ_surveys_code`; índice activo y GIN trigram sobre código y nombre. `is_active` es soft delete.

## SURVEY_VERSIONS

Descripción: versión inmutable una vez publicada/archivada de un instrumento.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Versión. |
| `survey_id` | uuid | No | — | No | `surveys.id` | Compuesta | Instrumento principal. |
| `version_number` | integer | No | — | No | No | Compuesta | Número > 0. |
| `title` | varchar(255) | No | — | No | No | No | Título de versión. |
| `instructions` | text | Sí | `NULL` | No | No | No | Instrucciones. |
| `status` | `survey_versions_status_enum` | No | `draft` | No | No | Parcial | `draft`, `published`, `archived`. |
| `published_at` | timestamptz | Sí | `NULL` | No | No | No | Obligatorio si está publicada. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: cuestionario 1 → N versiones; versión 1 → N dimensiones y 1 → N campañas, presentaciones, decisiones de aplicabilidad y resultados.

Reglas/observaciones: únicos (`survey_id`,`version_number`) y parcial `survey_id WHERE status='published'` (solo una publicada por instrumento); índice por status; CHECK número y coherencia de publicación. Triggers permiten editar solo borradores; una publicada solo puede pasar a archivada y una archivada es inmutable. `ON DELETE RESTRICT` hacia `surveys` evita cascada accidental.

## SURVEY_DIMENSIONS

Descripción: dimensiones ordenadas de una versión (unidad agregada de evaluación).

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Dimensión. |
| `version_id` | uuid | No | — | No | `survey_versions.id` | Compuesta | Versión. |
| `code` | varchar(80) | No | — | No | No | Compuesta | Código dentro de versión. |
| `title` | varchar(255) | No | — | No | No | No | Título. |
| `description` | text | Sí | `NULL` | No | No | No | Descripción. |
| `order` | integer | No | — | No | No | Compuesta | Orden >= 0. |

Relaciones: versión 1 → N dimensiones (`CASCADE`); dimensión 1 → N secciones y 1 → N resultados dimensionales.

Reglas/observaciones: únicos (`version_id`,`code`) y (`version_id`,`order`); CHECK orden; protegida por triggers si la versión no es borrador.

## SURVEY_SECTIONS

Descripción: agrupación ordenada de preguntas dentro de una dimensión.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Sección. |
| `dimension_id` | uuid | No | — | No | `survey_dimensions.id` | Compuesta | Dimensión. |
| `code` | varchar(80) | No | — | No | No | Compuesta | Código dentro de dimensión. |
| `title` | varchar(255) | No | — | No | No | No | Título. |
| `description` | text | Sí | `NULL` | No | No | No | Descripción. |
| `order` | integer | No | — | No | No | Compuesta | Orden >= 0. |

Relaciones: dimensión 1 → N secciones (`CASCADE`); sección 1 → N preguntas.

Reglas/observaciones: únicos (`dimension_id`,`code`) y (`dimension_id`,`order`); CHECK orden; protegida por triggers de versión.

## SURVEY_QUESTIONS

Descripción: preguntas de una sección, con tipo, obligatoriedad y validación de presentación.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Pregunta. |
| `section_id` | uuid | No | — | No | `survey_sections.id` | Compuesta | Sección. |
| `code` | varchar(80) | No | — | No | No | Compuesta | Código dentro de sección. |
| `type` | `survey_questions_type_enum` | No | — | No | No | No | Tipo de respuesta. |
| `prompt` | text | No | — | No | No | No | Enunciado. |
| `help_text` | text | Sí | `NULL` | No | No | No | Ayuda. |
| `required` | boolean | No | `false` | No | No | No | Requerida si resulta aplicable. |
| `order` | integer | No | — | No | No | Compuesta | Orden >= 0. |
| `validation` | jsonb | No | `{}` | No | No | No | `min`, `max`, `minLength`, `maxLength`, `maxSelections`, `placeholder`. |

Relaciones: sección 1 → N preguntas (`CASCADE`); pregunta 1 → N opciones, reglas, respuestas y decisiones de aplicabilidad.

Reglas/observaciones: únicos (`section_id`,`code`) y (`section_id`,`order`); checks orden y `validation` objeto JSON. El código no es globalmente único: lo es dentro de una sección. Trigger hereda inmutabilidad de la versión.

## SURVEY_OPTIONS

Descripción: opciones ordenadas y puntuadas para preguntas cerradas.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Opción. |
| `question_id` | uuid | No | — | No | `survey_questions.id` | Compuesta | Pregunta. |
| `value` | varchar(120) | No | — | No | No | Compuesta | Valor estable. |
| `label` | varchar(500) | No | — | No | No | No | Texto visible. |
| `help_text` | text | Sí | `NULL` | No | No | No | Ayuda. |
| `score` | integer | Sí | `NULL` | No | No | No | Puntaje 0..100. |
| `order` | integer | No | — | No | No | Compuesta | Orden >= 0. |

Relaciones: pregunta 1 → N opciones (`CASCADE`); opción 1 → N respuestas (`RESTRICT`).

Reglas/observaciones: únicos (`question_id`,`value`) y (`question_id`,`order`); checks score/orden; trigger de inmutabilidad. La política del cuestionario oficial restringe puntajes más que la DB (habitualmente 0/50/100, y 33/66 para Salud Mental).

## SURVEY_APPLICABILITY_RULES

Descripción: reglas ordenadas que deciden mostrar u omitir una pregunta según la ficha escolar.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Regla. |
| `question_id` | uuid | No | — | No | `survey_questions.id` | Compuesta | Pregunta. |
| `group_operator` | varchar(8) | No | — | No | No | No | `all` o `any`. |
| `action` | varchar(8) | No | — | No | No | No | `show` u `omit` si coincide. |
| `default_action` | varchar(8) | No | — | No | No | No | Acción si ninguna regla coincide. |
| `order` | integer | No | — | No | No | Compuesta | Prioridad >= 0. |

Relaciones: pregunta 1 → N reglas (`CASCADE`); regla 1 → N condiciones y 1 → N decisiones históricas que la aplicaron.

Reglas/observaciones: único (`question_id`,`order`); checks de dominios/orden. El motor toma la primera coincidencia. Trigger impide mutarla si la versión no es borrador.

## SURVEY_APPLICABILITY_CONDITIONS

Descripción: predicados que componen una regla de aplicabilidad.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `gen_random_uuid()` | Sí | No | Sí | Condición. |
| `rule_id` | uuid | No | — | No | `survey_applicability_rules.id` | Compuesta | Regla. |
| `feature` | varchar(40) | No | — | No | No | No | Hecho escolar. |
| `operator` | varchar(24) | No | — | No | No | No | Operador. |
| `expected_value` | jsonb | No | — | No | No | No | Valor esperado tipado. |
| `order` | integer | No | — | No | No | Compuesta | Orden >= 0. |

Relaciones: regla 1 → N condiciones (`CASCADE`).

Reglas/observaciones: único (`rule_id`,`order`), CHECK orden y trigger de inmutabilidad. Dominios validados solo por servicio: features `has_kiosk`, `has_food_service`, `is_boarding`, `shift`, `education_levels`, `enrollment_total`; operadores `equals`, `not_equals`, `in`, `contains`, `not_contains`, `contains_any`, `contains_all`, `greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal` según tipo.

## CAMPAIGNS

Descripción: etapa temporal que fija una versión de cuestionario y habilita un proceso de carga.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Campaña. |
| `name` | varchar(255) | No | — | No | No | No | Nombre. |
| `description` | text | Sí | `NULL` | No | No | No | Descripción. |
| `type` | `campaigns_type_enum` | No | — | No | No | No | `annual`/`semiannual`. |
| `status` | `campaigns_status_enum` | No | `draft` | No | No | No | Ciclo de vida. |
| `workflow_cycle` | varchar(120) | Sí | `NULL` | No | No | Parcial compuesta | Identificador de recorrido ordenado. |
| `sequence_order` | smallint | Sí | `NULL` | No | No | Parcial compuesta | Posición > 0. |
| `survey_version_id` | uuid | No | — | No | `survey_versions.id` | No | Versión fijada. |
| `starts_at` | timestamptz | No | — | No | No | No | Inicio. |
| `ends_at` | timestamptz | No | — | No | No | No | Fin. |
| `activated_at` | timestamptz | Sí | `NULL` | No | No | No | Activación. |
| `closed_at` | timestamptz | Sí | `NULL` | No | No | No | Cierre. |
| `archived_at` | timestamptz | Sí | `NULL` | No | No | No | Archivo lógico. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: versión 1 → N campañas (`RESTRICT`); campaña 1 → N asignaciones de escuelas, presentaciones y resultados.

Reglas/observaciones: CHECK fin > inicio; workflow ambos nulos o ambos informados; orden positivo. Índices (`status`,`starts_at`,`ends_at`), (`workflow_cycle`,`sequence_order`) y único parcial case-insensitive (`LOWER(workflow_cycle)`,`sequence_order`) cuando hay ciclo. Ciclo esperado por servicio: `draft → active → closed → archived`; el servicio exige versión publicada. `archived_at` es archivo lógico específico, no soft delete genérico.

## CAMPAIGN_SCHOOLS

Descripción: universo explícito de escuelas incluidas en una campaña; tabla intermedia N:M enriquecida e histórica.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Asignación. |
| `campaign_id` | uuid | No | — | No | `campaigns.id` | Compuesta | Campaña. |
| `school_id` | uuid | No | — | No | `schools.id` | Compuesta | Escuela. |
| `assigned_by_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Actor; nulo para migración histórica. |
| `assigned_at` | timestamptz | No | `now()` en DB | No | No | No | Fecha de inclusión. |
| `assignment_source` | `campaign_schools_assignment_source_enum` | No | — | No | No | No | `manual`, `filter`, `bulk`. |
| `removed_at` | timestamptz | Sí | `NULL` | No | No | No | Baja lógica/reactivable. |
| `removal_reason` | varchar(500) | Sí | `NULL` | No | No | No | Motivo de baja. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Creación física. |

Relaciones: `CAMPAIGNS N ↔ N SCHOOLS` mediante `CAMPAIGN_SCHOOLS`; campaña `CASCADE`, escuela `RESTRICT`; usuario 1 → N asignaciones como actor (`SET NULL`).

Reglas/observaciones: único (`campaign_id`,`school_id`) conserva una sola fila que se reactiva; índices (`campaign_id`,`removed_at`), (`school_id`,`removed_at`) y parcial (`campaign_id`,`assigned_at`,`school_id`) para vigentes. `removed_at` implementa soft delete. **Relación inferida:** una presentación debería corresponder a una fila vigente con el mismo par campaña/escuela, pero no hay FK compuesta.

## SURVEY_SUBMISSIONS

Descripción: presentación única de una escuela dentro de una campaña; comienza como borrador y puede finalizarse una sola vez.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Presentación. |
| `campaign_id` | uuid | No | — | No | `campaigns.id` | Compuesta | Campaña. |
| `school_id` | uuid | No | — | No | `schools.id` | Compuesta | Escuela. |
| `survey_version_id` | uuid | No | — | No | `survey_versions.id` | No | Versión respondida. |
| `school_rectification_id` | uuid | Sí | `NULL` | No | `school_rectifications.id` | No | Rectificación fuente. |
| `school_profile_snapshot` | jsonb | Sí | `NULL` | No | No | No | Ficha congelada. |
| `original_respondent_id` | uuid | Sí | `NULL` | No | `users.id` | No | Cuenta que inició/respondió. |
| `original_respondent_snapshot` | jsonb | No | — | No | No | No | `{id, firstName, lastName, email}` congelado. |
| `status` | `survey_submissions_status_enum` | No | `draft` | No | No | No | `draft`/`submitted`. |
| `started_at` | timestamptz | No | — | No | No | No | Inicio. |
| `last_saved_at` | timestamptz | Sí | `NULL` | No | No | No | Último guardado de borrador. |
| `submitted_at` | timestamptz | Sí | `NULL` | No | No | No | Envío final. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: campaña, escuela y versión 1 → N presentaciones (`RESTRICT`); rectificación y respondente 1 → N opcionales (`RESTRICT`); presentación 1 → N respuestas, 1 → N decisiones y 1 → 0..1 resultado.

Reglas/observaciones: único (`school_id`,`campaign_id`); índices (`campaign_id`,`status`), (`campaign_id`,`last_saved_at`) y (`campaign_id`,`submitted_at`). CHECK snapshot objeto y coherencia status/fecha. Trigger protege identidad desde el borrador y vuelve inmutable una fila enviada; solo permite `draft → submitted`. Relación inferida de consistencia: `survey_version_id` debe coincidir con `campaigns.survey_version_id`; `school_rectification_id.school_id` debe coincidir con `school_id`; la DB no lo verifica.

## SURVEY_ANSWERS

Descripción: una respuesta estructurada por pregunta y presentación.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Respuesta. |
| `submission_id` | uuid | No | — | No | `survey_submissions.id` | Compuesta | Presentación. |
| `question_id` | uuid | No | — | No | `survey_questions.id` | Compuesta | Pregunta. |
| `option_id` | uuid | Sí | `NULL` | No | `survey_options.id` | No | Opción cerrada. |
| `answer_value` | jsonb | Sí | `NULL` | No | No | No | Valor libre `string`, `number`, `boolean` o null. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: presentación 1 → N respuestas (`CASCADE`); pregunta/opción 1 → N respuestas (`RESTRICT`).

Reglas/observaciones: único (`submission_id`,`question_id`). Trigger impide cambios sobre respuestas de una presentación enviada y mover una respuesta entre presentaciones. **Relaciones inferidas:** la pregunta debe pertenecer a la versión de la presentación; `option_id`, si existe, debe pertenecer a `question_id`; la forma opción vs `answer_value` debe corresponder al tipo. Todo se valida en servicio, no mediante constraint compuesta.

## SUBMISSION_QUESTION_APPLICABILITY

Descripción: decisión de aplicabilidad congelada para cada pregunta de una presentación.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Decisión. |
| `submission_id` | uuid | No | — | No | `survey_submissions.id` | Compuesta | Presentación. |
| `question_id` | uuid | No | — | No | `survey_questions.id` | Compuesta | Pregunta. |
| `survey_version_id` | uuid | No | — | No | `survey_versions.id` | No | Versión evaluada. |
| `applied_rule_id` | uuid | Sí | `NULL` | No | `survey_applicability_rules.id` | No | Regla coincidente. |
| `status` | varchar(16) | No | — | No | No | No | `applicable`, `excluded`, `incomplete`. |
| `reason_code` | varchar(60) | No | — | No | No | No | Motivo estable. |
| `reason_description` | text | No | — | No | No | No | Explicación congelada. |
| `missing_features` | jsonb | No | `[]` | No | No | No | Array de hechos faltantes. |
| `relevant_school_facts` | jsonb | No | `{}` | No | No | No | Hechos usados. |
| `evaluated_at` | timestamptz | No | — | No | No | No | Momento de evaluación. |

Relaciones: presentación 1 → N decisiones (`CASCADE`); pregunta, versión y regla 1 → N (`RESTRICT`, regla opcional).

Reglas/observaciones: único (`submission_id`,`question_id`); índice (`submission_id`,`status`); checks de status y formas JSON. Trigger protege decisiones de envíos finalizados y su identidad; una migración posterior permite una reparación excepcional solo si la transacción configura `app.allow_submitted_applicability_repair='on'`. Consistencias pregunta-versión-regla-presentación son relaciones inferidas sin constraints compuestas.

## EVALUATION_CONFIGURATIONS

Descripción: versión auditable de rangos de estrellas y regla crítica de Salud Mental.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Configuración. |
| `version_code` | varchar(50) | No | — | No | No | Sí | Versión funcional. |
| `name` | varchar(160) | No | — | No | No | No | Nombre. |
| `description` | text | Sí | `NULL` | No | No | No | Descripción. |
| `status` | `evaluation_configurations_status_enum` | No | `draft` | No | No | Parcial | `draft`, `active`, `archived`. |
| `mental_health_critical_threshold` | numeric(11,8) | No | — | No | No | No | Umbral 0..100. |
| `mental_health_max_stars` | smallint | No | — | No | No | No | Tope 1..5. |
| `metadata` | jsonb | No | `{}` | No | No | No | Metadatos/versionado de algoritmo. |
| `created_by_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Creador. |
| `activated_at` | timestamptz | Sí | `NULL` | No | No | No | Activación. |
| `activated_by_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Actor de activación. |
| `archived_at` | timestamptz | Sí | `NULL` | No | No | No | Archivo. |
| `archived_by_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Actor de archivo. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Modificación. |

Relaciones: usuarios 1 → N por los tres roles (`SET NULL`); configuración 1 → N rangos y 1 → N resultados.

Reglas/observaciones: único `version_code`; único parcial sobre `status='active'`, por lo que solo hay una activa; checks umbral/tope. Ciclo `draft → active → archived` validado por servicio. La migración crea activa `v1.0.0` con umbral 33 y tope de 4 estrellas para criticidad.

## EVALUATION_STAR_RANGES

Descripción: intervalos de puntaje que asignan estrellas dentro de una configuración.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Rango. |
| `configuration_id` | uuid | No | — | No | `evaluation_configurations.id` | Compuesta | Configuración. |
| `stars` | smallint | No | — | No | No | Compuesta | 1..5. |
| `lower_bound` | numeric(11,8) | No | — | No | No | No | Límite inferior. |
| `upper_bound` | numeric(11,8) | No | — | No | No | No | Límite superior. |
| `lower_inclusive` | boolean | No | — | No | No | No | Inclusión inferior. |
| `upper_inclusive` | boolean | No | — | No | No | No | Inclusión superior. |
| `order` | smallint | No | — | No | No | Compuesta | Orden. |

Relaciones: configuración 1 → N rangos (`CASCADE`).

Reglas/observaciones: únicos (`configuration_id`,`stars`) y (`configuration_id`,`order`); checks estrellas y límites 0..100. Contigüidad, ausencia de solapamientos y exactamente cinco rangos se validan en servicio, no en DB.

## EVALUATION_RESULTS

Descripción: resultado vigente y reproducible de una presentación. Duplica claves de contexto para consultas y conserva snapshots/versiones de cálculo.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Resultado. |
| `submission_id` | uuid | No | — | No | `survey_submissions.id` | Sí | Una evaluación por presentación. |
| `campaign_id` | uuid | No | — | No | `campaigns.id` | No | Campaña copiada. |
| `school_id` | uuid | No | — | No | `schools.id` | No | Escuela copiada. |
| `survey_version_id` | uuid | No | — | No | `survey_versions.id` | No | Versión copiada. |
| `general_score` | numeric(11,8) | No | — | No | No | No | Puntaje 0..100. |
| `general_numerator` | numeric(16,8) | No | — | No | No | No | Suma/base de cálculo. |
| `general_denominator` | integer | No | — | No | No | No | Cantidad aplicable > 0. |
| `algorithm_version` | varchar(100) | No | — | No | No | No | Algoritmo. |
| `snapshot_schema_version` | integer | No | — | No | No | No | Versión del JSON > 0. |
| `snapshot` | jsonb | No | — | No | No | No | Evidencia autocontenida del cálculo. |
| `calculated_at` | timestamptz | No | — | No | No | No | Momento. |
| `calculated_by_user_id` | uuid | Sí | `NULL` | No | `users.id` | No | Actor, si aplica. |
| `calculation_source` | varchar(40) | No | — | No | No | No | Fuente del cálculo. |
| `stars` | smallint | Sí | `NULL` | No | No | No | Estrellas finales 1..5. |
| `base_stars` | smallint | Sí | `NULL` | No | No | No | Estrellas antes de topes. |
| `evaluation_configuration_id` | uuid | Sí | `NULL` | No | `evaluation_configurations.id` | No | Configuración usada. |
| `evaluation_configuration_version` | varchar(50) | Sí | `NULL` | No | No | No | Código congelado. |
| `evaluation_rule_snapshot` | jsonb | Sí | `NULL` | No | No | No | Reglas congeladas. |
| `evaluation_alerts` | jsonb | No | `[]` | No | No | No | Alertas generadas. |
| `star_rule_version` | varchar(100) | Sí | `NULL` | No | No | No | Versión de asignación. |
| `star_blocking_reasons` | jsonb | No | `[]` | No | No | No | Motivos para no certificar. |
| `created_at` | timestamptz | No | `now()` | No | No | No | Alta. |
| `updated_at` | timestamptz | No | `now()` | No | No | No | Recálculo/modificación. |

Relaciones: presentación 1 → 0..1 resultado (`RESTRICT`); campaña/escuela/versión 1 → N resultados (`RESTRICT`); usuario 1 → N (`SET NULL`); configuración 1 → N opcional (`RESTRICT`); resultado 1 → N dimensiones.

Reglas/observaciones: unique constraint sobre `submission_id`; índices campaña, escuela, versión, fecha y parcial (`campaign_id`,`stars`) con estrellas no nulas. Checks de puntajes, componentes, versión, forma mínima del snapshot, estrellas y arrays JSON. El algoritmo vigente es `question-average-dynamic-denominator-v1`, snapshot schema 2. **Relación inferida:** campaña, escuela y versión deben ser iguales a las de la presentación, pero son FKs independientes y la DB no compara sus valores. Al recalcular se actualiza esta misma fila y se reemplazan resultados dimensionales; el snapshot conserva el estado reproducible vigente, no múltiples filas por recálculo.

## EVALUATION_DIMENSION_RESULTS

Descripción: desglose por dimensión de un resultado, con datos duplicados para preservar etiqueta y facilitar consulta.

| Campo | Tipo | NULL | Default | PK | FK | Unique | Descripción |
|---|---|---:|---|---:|---:|---:|---|
| `id` | uuid | No | `uuid_generate_v4()` | Sí | No | Sí | Resultado dimensional. |
| `result_id` | uuid | No | — | No | `evaluation_results.id` | Compuesta | Resultado general. |
| `dimension_id` | uuid | No | — | No | `survey_dimensions.id` | Compuesta | Dimensión fuente. |
| `dimension_code` | varchar(80) | No | — | No | No | No | Código congelado. |
| `dimension_title` | varchar(255) | No | — | No | No | No | Título congelado. |
| `order` | integer | No | — | No | No | No | Orden >= 0. |
| `numerator` | numeric(16,8) | No | — | No | No | No | Componente >= 0. |
| `denominator` | integer | No | — | No | No | No | Cantidad aplicable >= 0. |
| `score` | numeric(11,8) | Sí | `NULL` | No | No | No | 0..100, nulo si denominador 0. |
| `is_critical` | boolean | No | `false` | No | No | No | Área crítica. |
| `critical_value` | numeric(11,8) | Sí | `NULL` | No | No | No | Valor comparado. |
| `critical_threshold` | numeric(11,8) | Sí | `NULL` | No | No | No | Umbral. |
| `critical_rule_version` | varchar(100) | Sí | `NULL` | No | No | No | Regla usada. |

Relaciones: resultado 1 → N filas (`CASCADE`); dimensión 1 → N resultados históricos (`RESTRICT`).

Reglas/observaciones: único (`result_id`,`dimension_id`); índices dimensión, (`dimension_code`,`score`) y (`is_critical`,`dimension_code`). Checks rigurosos de componentes, score y coherencia de criticidad. **Relación inferida:** la dimensión debe pertenecer a `evaluation_results.survey_version_id`, sin FK compuesta.

# 3. Relaciones completas

## FKs explícitas

En la tabla siguiente, la cardinalidad se lee desde el origen dependiente hacia el destino principal.

| Origen | Campo | Destino | Campo destino | Cardinalidad | Tipo | Descripción |
|---|---|---|---|---|---|---|
| `user_schools` | `user_id` | `users` | `id` | 0..1:1 | Relación N (restringida a 1:1) | Lado usuario de la asociación vigente; CASCADE. |
| `user_schools` | `school_id` | `schools` | `id` | 0..1:1 | Relación N (restringida a 1:1) | Lado escuela; CASCADE. |
| `auth_sessions` | `user_id` | `users` | `id` | N:1 | FK explícita | Sesiones del usuario; CASCADE. |
| `password_reset_tokens` | `user_id` | `users` | `id` | N:1 | FK explícita | Tokens del usuario; CASCADE. |
| `audit_logs` | `actor_user_id` | `users` | `id` | N:0..1 | FK explícita | Actor opcional; SET NULL. |
| `schools` | `shift_catalog_id` | `school_shift_catalogs` | `id` | N:0..1 | FK explícita | Jornada estructurada; RESTRICT. |
| `school_education_levels` | `school_id` | `schools` | `id` | N:1 | Relación N | Puente escuela-nivel; CASCADE. |
| `school_education_levels` | `level_id` | `education_level_catalogs` | `id` | N:1 | Relación N | Puente escuela-nivel; RESTRICT. |
| `school_contacts` | `school_id` | `schools` | `id` | N:1 | FK explícita | Contactos; CASCADE. |
| `school_rectifications` | `school_id` | `schools` | `id` | N:1 | FK explícita | Historial de ficha; CASCADE. |
| `school_rectifications` | `actor_user_id` | `users` | `id` | N:0..1 | FK explícita | Confirmante; SET NULL. |
| `school_rectification_education_levels` | `rectification_id` | `school_rectifications` | `id` | N:1 | Relación N | Detalle histórico; CASCADE. |
| `school_rectification_education_levels` | `level_id` | `education_level_catalogs` | `id` | N:1 | Relación N | Catálogo de origen; RESTRICT. |
| `school_user_assignment_history` | `school_id` | `schools` | `id` | N:1 | FK explícita | Escuela auditada; CASCADE. |
| `school_user_assignment_history` | `previous_user_id` | `users` | `id` | N:0..1 | FK explícita | Usuario anterior; SET NULL. |
| `school_user_assignment_history` | `new_user_id` | `users` | `id` | N:0..1 | FK explícita | Usuario nuevo; SET NULL. |
| `school_user_assignment_history` | `actor_user_id` | `users` | `id` | N:0..1 | FK explícita | Actor; SET NULL. |
| `survey_versions` | `survey_id` | `surveys` | `id` | N:1 | FK explícita | Versionado; RESTRICT. |
| `survey_dimensions` | `version_id` | `survey_versions` | `id` | N:1 | FK explícita | Jerarquía; CASCADE. |
| `survey_sections` | `dimension_id` | `survey_dimensions` | `id` | N:1 | FK explícita | Jerarquía; CASCADE. |
| `survey_questions` | `section_id` | `survey_sections` | `id` | N:1 | FK explícita | Jerarquía; CASCADE. |
| `survey_options` | `question_id` | `survey_questions` | `id` | N:1 | FK explícita | Opciones; CASCADE. |
| `survey_applicability_rules` | `question_id` | `survey_questions` | `id` | N:1 | FK explícita | Reglas; CASCADE. |
| `survey_applicability_conditions` | `rule_id` | `survey_applicability_rules` | `id` | N:1 | FK explícita | Condiciones; CASCADE. |
| `campaigns` | `survey_version_id` | `survey_versions` | `id` | N:1 | FK explícita | Versión usada; RESTRICT. |
| `campaign_schools` | `campaign_id` | `campaigns` | `id` | N:1 | Relación N | Puente campaña-escuela; CASCADE. |
| `campaign_schools` | `school_id` | `schools` | `id` | N:1 | Relación N | Puente campaña-escuela; RESTRICT. |
| `campaign_schools` | `assigned_by_user_id` | `users` | `id` | N:0..1 | FK explícita | Actor; SET NULL. |
| `survey_submissions` | `campaign_id` | `campaigns` | `id` | N:1 | FK explícita | Etapa; RESTRICT. |
| `survey_submissions` | `school_id` | `schools` | `id` | N:1 | FK explícita | Escuela; RESTRICT. |
| `survey_submissions` | `survey_version_id` | `survey_versions` | `id` | N:1 | FK explícita | Instrumento; RESTRICT. |
| `survey_submissions` | `school_rectification_id` | `school_rectifications` | `id` | N:0..1 | FK explícita | Ficha histórica; RESTRICT. |
| `survey_submissions` | `original_respondent_id` | `users` | `id` | N:0..1 | FK explícita | Respondente; RESTRICT. |
| `survey_answers` | `submission_id` | `survey_submissions` | `id` | N:1 | FK explícita | Respuestas; CASCADE. |
| `survey_answers` | `question_id` | `survey_questions` | `id` | N:1 | FK explícita | Pregunta; RESTRICT. |
| `survey_answers` | `option_id` | `survey_options` | `id` | N:0..1 | FK explícita | Opción; RESTRICT. |
| `submission_question_applicability` | `submission_id` | `survey_submissions` | `id` | N:1 | FK explícita | Decisiones; CASCADE. |
| `submission_question_applicability` | `question_id` | `survey_questions` | `id` | N:1 | FK explícita | Pregunta; RESTRICT. |
| `submission_question_applicability` | `survey_version_id` | `survey_versions` | `id` | N:1 | FK explícita | Versión; RESTRICT. |
| `submission_question_applicability` | `applied_rule_id` | `survey_applicability_rules` | `id` | N:0..1 | FK explícita | Regla coincidente; RESTRICT. |
| `evaluation_configurations` | `created_by_user_id` | `users` | `id` | N:0..1 | FK explícita | Creador; SET NULL. |
| `evaluation_configurations` | `activated_by_user_id` | `users` | `id` | N:0..1 | FK explícita | Activador; SET NULL. |
| `evaluation_configurations` | `archived_by_user_id` | `users` | `id` | N:0..1 | FK explícita | Archivador; SET NULL. |
| `evaluation_star_ranges` | `configuration_id` | `evaluation_configurations` | `id` | N:1 | FK explícita | Rangos; CASCADE. |
| `evaluation_results` | `submission_id` | `survey_submissions` | `id` | 0..1:1 | FK explícita | Único por submission; RESTRICT. |
| `evaluation_results` | `campaign_id` | `campaigns` | `id` | N:1 | FK explícita | Contexto duplicado; RESTRICT. |
| `evaluation_results` | `school_id` | `schools` | `id` | N:1 | FK explícita | Contexto duplicado; RESTRICT. |
| `evaluation_results` | `survey_version_id` | `survey_versions` | `id` | N:1 | FK explícita | Contexto duplicado; RESTRICT. |
| `evaluation_results` | `calculated_by_user_id` | `users` | `id` | N:0..1 | FK explícita | Actor; SET NULL. |
| `evaluation_results` | `evaluation_configuration_id` | `evaluation_configurations` | `id` | N:0..1 | FK explícita | Configuración; RESTRICT. |
| `evaluation_dimension_results` | `result_id` | `evaluation_results` | `id` | N:1 | FK explícita | Desglose; CASCADE. |
| `evaluation_dimension_results` | `dimension_id` | `survey_dimensions` | `id` | N:1 | FK explícita | Dimensión fuente; RESTRICT. |

## Relaciones N:M implementadas

```text
USERS 0..1 ── USER_SCHOOLS ── 0..1 SCHOOLS
```

Es una tabla puente en forma, pero los únicos sobre cada FK impiden N:M y materializan 1:1 opcional.

```text
SCHOOLS N ── SCHOOL_EDUCATION_LEVELS ── N EDUCATION_LEVEL_CATALOGS
```

La tabla puente añade matrícula y orden actuales.

```text
SCHOOL_RECTIFICATIONS N ── SCHOOL_RECTIFICATION_EDUCATION_LEVELS ── N EDUCATION_LEVEL_CATALOGS
```

La tabla puente histórica añade código, etiqueta, matrícula y orden congelados.

```text
CAMPAIGNS N ── CAMPAIGN_SCHOOLS ── N SCHOOLS
```

La tabla puente añade actor, fecha, origen y baja/reactivación.

## Relaciones inferidas o compuestas no protegidas

| Origen lógico | Destino lógico | Cardinalidad | Tipo | Evidencia y limitación |
|---|---|---|---|---|
| `audit_logs.(entity_type,entity_id)` | múltiples tablas | N:0..1 | Relación inferida | Los servicios graban tipo/UUID del agregado; no hay FK polimórfica. |
| `survey_submissions.(campaign_id,school_id)` | `campaign_schools.(campaign_id,school_id)` | N:1 vigente | Relación inferida | El servicio exige escuela asignada; ninguna FK compuesta lo garantiza. |
| `survey_submissions.survey_version_id` | `campaigns.survey_version_id` | N:1 por campaña | Relación inferida | El servicio copia la versión de la campaña; DB permite divergencia. |
| `survey_submissions.school_rectification_id` | rectificación de la misma `school_id` | N:0..1 | Relación inferida | Se captura en el flujo; DB solo verifica que ambas filas existan. |
| `survey_answers.question_id` | pregunta de `submission.survey_version_id` | N:1 | Relación inferida | Validada al guardar; no hay clave compuesta de pertenencia. |
| `survey_answers.option_id` | opción de `survey_answers.question_id` | N:0..1 | Relación inferida | Validada por servicio; FKs independientes. |
| `submission_question_applicability.question_id` | pregunta de `survey_version_id` y de la presentación | N:1 | Relación inferida | El motor contrasta el conjunto completo; no hay FK compuesta. |
| `submission_question_applicability.applied_rule_id` | regla de `question_id` | N:0..1 | Relación inferida | Validada por servicio; DB solo verifica existencia. |
| `evaluation_results.(campaign_id,school_id,survey_version_id)` | mismas claves de `submission_id` | 1:1 | Relación inferida | Datos desnormalizados para consulta/snapshot; no hay CHECK/FK compuesta. |
| `evaluation_dimension_results.dimension_id` | dimensión de `evaluation_results.survey_version_id` | N:1 | Relación inferida | Se crea desde la versión cargada; DB no cruza ambas ramas. |
| `campaigns.(workflow_cycle,sequence_order)` | campaña anterior/siguiente | 0..1:0..1 | Relación inferida | Orden lógico por valores, sin self-FK; servicio controla prerrequisitos por escuela. |

# 4. Modelo por módulos

## Identidad, autenticación y permisos

`users` es la única tabla de identidad y `role` contiene los dos roles globales; no existen tablas `roles`, `permissions` ni ACL. `user_schools` delimita el recurso escolar accesible por una cuenta `school`. `auth_sessions` permite revocar JWT y `password_reset_tokens` implementa recuperación segura. Los guards aplican autorización en backend.

## Escuelas y ficha institucional

`schools` contiene el presente. `school_shift_catalogs`, `education_level_catalogs`, `school_education_levels` y `school_contacts` estructuran datos antes desnormalizados. `school_rectifications` y su detalle de niveles congelan el pasado; `school_user_assignment_history` conserva cambios de responsable. El padrón actual puede desactivarse sin perder historia.

## Cuestionario y motor condicional

La cadena principal es:

```text
SURVEYS → SURVEY_VERSIONS → SURVEY_DIMENSIONS → SURVEY_SECTIONS
                                              → SURVEY_QUESTIONS → SURVEY_OPTIONS
                                                                 → SURVEY_APPLICABILITY_RULES
                                                                    → SURVEY_APPLICABILITY_CONDITIONS
```

La cascada permite rehacer un borrador, mientras triggers impiden modificar versiones publicadas/archivadas. Las condiciones consumen hechos obtenidos del snapshot escolar, no una FK directa a catálogos.

## Campañas y participación

`campaigns` fija versión y ventana temporal. `campaign_schools` fija el universo; `workflow_cycle/sequence_order` encadena etapas lógicas. `survey_submissions` representa como máximo una carga por escuela/campaña. No existe tabla separada de “estado de participación”: el dashboard deriva sin iniciar/en borrador/enviado combinando asignación y presentación.

## Presentaciones y evaluación

`survey_answers` guarda respuestas; `submission_question_applicability` congela inclusiones/exclusiones. Al enviar, se genera/actualiza `evaluation_results` y se reemplazan sus `evaluation_dimension_results`. `evaluation_configurations` y `evaluation_star_ranges` versionan las reglas, mientras snapshots preservan lo aplicado.

## Auditoría, exportaciones y reportes

`audit_logs` registra cambios y exportaciones. Dashboard, exportaciones CSV/XLSX y reportes PDF consultan las tablas anteriores; no tienen tablas propias ni persistencia de archivos.

# 5. Flujos principales de datos

## Alta y acceso escolar

```text
USERS → USER_SCHOOLS → SCHOOLS
  ├── AUTH_SESSIONS
  └── PASSWORD_RESET_TOKENS
```

Una cuenta escolar se asocia a una única escuela. Los reemplazos modifican `user_schools`, invalidan sesiones cuando corresponde y agregan `school_user_assignment_history`/`audit_logs`.

## Rectificación anual

```text
SCHOOLS + CONTACTS + SCHOOL_EDUCATION_LEVELS + CATÁLOGOS
  → SCHOOL_RECTIFICATIONS
  → SCHOOL_RECTIFICATION_EDUCATION_LEVELS
```

Se actualiza el presente y simultáneamente se genera una constancia inmutable. La presentación toma esa constancia y copia `school_profile_snapshot`.

## Diseño y publicación del cuestionario

```text
SURVEYS → SURVEY_VERSIONS(draft)
  → DIMENSIONS → SECTIONS → QUESTIONS → OPTIONS
                                    └── RULES → CONDITIONS
  → SURVEY_VERSIONS(published)
```

Solo el borrador se edita. Publicar congela toda la rama; el índice parcial garantiza una sola versión publicada por instrumento.

## Preparación de campaña

```text
SURVEY_VERSION(published) → CAMPAIGN(draft)
SCHOOLS → CAMPAIGN_SCHOOLS
CAMPAIGN: draft → active → closed → archived
```

En workflows ordenados, una escuela avanza por etapas según `sequence_order`; la relación entre etapas es por clave lógica, no self-FK.

## Borrador, aplicabilidad y envío

```text
CAMPAIGN_SCHOOLS + USER_SCHOOLS + SCHOOL_RECTIFICATIONS
  → SURVEY_SUBMISSIONS(draft)
     ├── SURVEY_ANSWERS
     └── SUBMISSION_QUESTION_APPLICABILITY
  → SURVEY_SUBMISSIONS(submitted, inmutable)
```

El motor lee la versión y el snapshot escolar, persiste una decisión por pregunta, bloquea datos incompletos y excluye preguntas no aplicables. Al enviar, respuestas y decisiones quedan protegidas por triggers.

## Evaluación y certificación

```text
SUBMISSION(submitted)
  + ANSWERS
  + APPLICABILITY
  + SURVEY_VERSION
  + EVALUATION_CONFIGURATION → STAR_RANGES
  → EVALUATION_RESULT → EVALUATION_DIMENSION_RESULTS
```

El resultado calcula solo preguntas aplicables, aplica criticidad/tope de estrellas y guarda versiones y snapshots. Dashboards y reportes consumen el resultado ya calculado.

## Auditoría

```text
USERS + operación funcional → AUDIT_LOGS
```

El actor tiene FK; el agregado auditado se referencia polimórficamente por texto + UUID.

# 6. Entidades centrales

Principales/core:

- `users`: identidad y actor transversal.
- `schools`: agregado institucional y eje territorial.
- `surveys` / `survey_versions`: definición versionada del instrumento.
- `campaigns`: contexto temporal y operativo.
- `survey_submissions`: transacción central escuela-campaña.
- `evaluation_results`: diagnóstico/certificación calculado.

Secundarias estructurales:

- Jerarquía de cuestionario: dimensiones, secciones, preguntas, opciones, reglas y condiciones.
- Participación y contenido: `campaign_schools`, `survey_answers`, `submission_question_applicability`, `evaluation_dimension_results`.
- Historia escolar: `school_rectifications` y sus niveles.
- Configuración: `evaluation_configurations` y `evaluation_star_ranges`.

Auxiliares:

- Catálogos de jornada/nivel, contactos, niveles actuales.
- `user_schools`, sesiones, tokens, historial de asignación y auditoría.

# 7. Observaciones e inconsistencias

1. **Dependencia UUID no declarada.** La primera migración crea `pgcrypto`, pero numerosas migraciones posteriores usan `uuid_generate_v4()`, función de `uuid-ossp`. No hay `CREATE EXTENSION "uuid-ossp"` en el repositorio. Una base limpia sin esa extensión fallará al crear `campaigns` y tablas posteriores. Debe corregirse con una nueva migración (sin editar migraciones ya aplicadas) o estandarizar nuevos defaults en `gen_random_uuid()`.

2. **Metadatos TypeORM e índices físicos no coinciden por completo.** Con `synchronize:false` esto no cambia la DB, pero una futura migración autogenerada puede intentar renombrar/eliminar índices. Ejemplos: entidades no declaran los índices trigram, `auth_sessions(user_id,revoked_at,expires_at)`, `password_reset_tokens(user_id,used_at,expires_at)`, `campaign_schools` parcial vigente, `campaigns` único parcial case-insensitive ni `evaluation_results(campaign_id,stars)`; `AuditLog` declara índices simples mientras la migración usa (`entity_id`,`created_at`); `SchoolUserAssignmentHistory` declara simple por escuela mientras la migración usa (`school_id`,`created_at`).

3. **Timestamps duplicados de migración.** Hay pares con el mismo sufijo: `1720375207000`, `1720375211000` y `1720375218000`. Hoy los pares no dependen directamente entre sí, pero el orden dentro del empate puede variar y complica trazabilidad/herramientas. Conviene que futuras migraciones tengan timestamp único.

4. **Integridad compuesta delegada al servicio.** La DB no garantiza las diez relaciones inferidas listadas arriba. El mayor riesgo es aceptar por SQL directo una respuesta con opción de otra pregunta, una presentación con versión distinta de la campaña o un resultado cuyo contexto no coincide con la presentación. Los servicios actuales realizan verificaciones, pero imports/scripts futuros deben reutilizarlas o agregar constraints compuestas viables.

5. **Campos escolares duplicados durante transición.** `shift` coexiste con `shift_catalog_id`; `education_level` con `school_education_levels`; `referent_*` con `school_contacts`; tres booleanos también fueron migrados desde `characteristics`. Esto parece compatibilidad/migración progresiva, no relaciones adicionales. Debe definirse una fuente canónica antes de retirar campos legado.

6. **Auditoría polimórfica sin integridad referencial.** `entity_type/entity_id` puede quedar huérfano o contener tipos libres. Es deliberadamente flexible, pero el DER debe mostrarlo como relación inferida, nunca como FK.

7. **Nombre engañoso de `user_schools`.** Su PK parece N:M, pero ambos lados son únicos: actualmente es 1:1 opcional. Si en el futuro una cuenta administra varias escuelas, deberán cambiarse índices y reglas, no solo código.

8. **Tipos de pregunta más amplios que el flujo institucional.** El enum persiste siete tipos, incluido `multiple_choice`, pero `SubmissionsService` rechaza explícitamente selección múltiple y la evaluación puntúa una sola `option_id`. El esquema soporta definir ese tipo, no responderlo en el flujo actual. Los booleanos se guardan como strings `yes`/`no` en `answer_value` pese a que JSONB podría almacenar boolean real.

9. **Defaults de entidad vs migración.** `CampaignSchool.assigned_at` no declara default en TypeORM, aunque la DB tiene `now()`. Varias columnas JSON usan `default: []/{}` en entidad y literales JSONB en migración. No es un error de ejecución actual, pero debe evitarse confiar en metadata para reproducir exactamente el esquema.

10. **Historia de recálculos.** Existe un único `evaluation_results` por presentación. Un recálculo actualiza esa fila y sustituye el detalle; el snapshot guarda reproducibilidad del resultado vigente y la auditoría registra la acción, pero no hay una tabla de versiones de resultado. Si se requiere comparar cada recálculo histórico, hoy no está modelado de forma relacional completa.

11. **Soft deletes heterogéneos.** No existe `deleted_at`. `users.is_active`, `schools.is_active`, `surveys.is_active` y catálogos `is_active` son bajas lógicas; `campaign_schools.removed_at` conserva baja/reactivación; `campaigns.archived_at/status` y versiones/configuraciones `status=archived` son archivo de ciclo de vida. No deben dibujarse como un mecanismo común inexistente.

12. **Inmutabilidad desigual.** Versiones publicadas, rectificaciones y presentaciones enviadas sí tienen protección mediante trigger. `audit_logs`, `school_user_assignment_history` y resultados se tratan históricamente en servicios, pero no son append-only a nivel DB; resultados se actualizan intencionalmente.

13. **No hay modelo de documentos.** Los archivos de plantillas, importaciones y reportes no generan entidad persistente. No agregar `files`, `documents` o `attachments` al DER.

14. **Tabla técnica de migraciones fuera del modelo funcional.** TypeORM puede crear `migrations` para registrar ejecuciones. Como no hay `migrationTableName` personalizado ni una entidad asociada, se considera infraestructura del ORM y no una entidad del dominio; solo se dibujaría en un DER físico/operacional, después de verificar la instancia real.

# 8. Información necesaria para construir el DER

## Lista definitiva de entidades (30)

Principales para ubicar en el centro:

1. `users` — PK `id`.
2. `schools` — PK `id`; FK `shift_catalog_id`.
3. `surveys` — PK `id`.
4. `survey_versions` — PK `id`; FK `survey_id`.
5. `campaigns` — PK `id`; FK `survey_version_id`.
6. `survey_submissions` — PK `id`; FKs `campaign_id`, `school_id`, `survey_version_id`, `school_rectification_id`, `original_respondent_id`.
7. `evaluation_results` — PK `id`; FKs `submission_id`, `campaign_id`, `school_id`, `survey_version_id`, `calculated_by_user_id`, `evaluation_configuration_id`.

Estructurales/secundarias:

8. `survey_dimensions` — PK `id`; FK `version_id`.
9. `survey_sections` — PK `id`; FK `dimension_id`.
10. `survey_questions` — PK `id`; FK `section_id`.
11. `survey_options` — PK `id`; FK `question_id`.
12. `survey_applicability_rules` — PK `id`; FK `question_id`.
13. `survey_applicability_conditions` — PK `id`; FK `rule_id`.
14. `campaign_schools` — PK `id`; FKs `campaign_id`, `school_id`, `assigned_by_user_id`; puente N:M.
15. `survey_answers` — PK `id`; FKs `submission_id`, `question_id`, `option_id`.
16. `submission_question_applicability` — PK `id`; FKs `submission_id`, `question_id`, `survey_version_id`, `applied_rule_id`.
17. `evaluation_dimension_results` — PK `id`; FKs `result_id`, `dimension_id`.
18. `school_rectifications` — PK `id`; FKs `school_id`, `actor_user_id`.
19. `school_rectification_education_levels` — PK `id`; FKs `rectification_id`, `level_id`; puente histórico N:M.
20. `evaluation_configurations` — PK `id`; FKs `created_by_user_id`, `activated_by_user_id`, `archived_by_user_id`.
21. `evaluation_star_ranges` — PK `id`; FK `configuration_id`.

Auxiliares:

22. `user_schools` — PK compuesta (`user_id`,`school_id`); ambas FKs; puente restringido a 1:1.
23. `auth_sessions` — PK `id`; FK `user_id`.
24. `password_reset_tokens` — PK `id`; FK `user_id`.
25. `audit_logs` — PK `id`; FK `actor_user_id`; referencia polimórfica inferida.
26. `school_shift_catalogs` — PK `id`.
27. `education_level_catalogs` — PK `id`.
28. `school_education_levels` — PK `id`; FKs `school_id`, `level_id`; puente N:M actual.
29. `school_contacts` — PK `id`; FK `school_id`.
30. `school_user_assignment_history` — PK `id`; FKs `school_id`, `previous_user_id`, `new_user_id`, `actor_user_id`.

## Cardinalidades definitivas para las líneas del DER

```text
USERS 1 ── 0..1 USER_SCHOOLS 0..1 ── 1 SCHOOLS
USERS 1 ── N AUTH_SESSIONS
USERS 1 ── N PASSWORD_RESET_TOKENS
USERS 1 ── N AUDIT_LOGS (actor opcional)

SCHOOL_SHIFT_CATALOGS 1 ── N SCHOOLS
SCHOOLS 1 ── N SCHOOL_CONTACTS
SCHOOLS 1 ── N SCHOOL_EDUCATION_LEVELS N ── 1 EDUCATION_LEVEL_CATALOGS
SCHOOLS 1 ── N SCHOOL_RECTIFICATIONS
SCHOOL_RECTIFICATIONS 1 ── N SCHOOL_RECTIFICATION_EDUCATION_LEVELS N ── 1 EDUCATION_LEVEL_CATALOGS
SCHOOLS 1 ── N SCHOOL_USER_ASSIGNMENT_HISTORY

SURVEYS 1 ── N SURVEY_VERSIONS
SURVEY_VERSIONS 1 ── N SURVEY_DIMENSIONS
SURVEY_DIMENSIONS 1 ── N SURVEY_SECTIONS
SURVEY_SECTIONS 1 ── N SURVEY_QUESTIONS
SURVEY_QUESTIONS 1 ── N SURVEY_OPTIONS
SURVEY_QUESTIONS 1 ── N SURVEY_APPLICABILITY_RULES
SURVEY_APPLICABILITY_RULES 1 ── N SURVEY_APPLICABILITY_CONDITIONS

SURVEY_VERSIONS 1 ── N CAMPAIGNS
CAMPAIGNS 1 ── N CAMPAIGN_SCHOOLS N ── 1 SCHOOLS
CAMPAIGNS 1 ── N SURVEY_SUBMISSIONS
SCHOOLS 1 ── N SURVEY_SUBMISSIONS
SURVEY_VERSIONS 1 ── N SURVEY_SUBMISSIONS
SCHOOL_RECTIFICATIONS 1 ── N SURVEY_SUBMISSIONS (opcional desde submission)
USERS 1 ── N SURVEY_SUBMISSIONS (respondente opcional)

SURVEY_SUBMISSIONS 1 ── N SURVEY_ANSWERS
SURVEY_QUESTIONS 1 ── N SURVEY_ANSWERS
SURVEY_OPTIONS 1 ── N SURVEY_ANSWERS (opcional desde answer)
SURVEY_SUBMISSIONS 1 ── N SUBMISSION_QUESTION_APPLICABILITY
SURVEY_QUESTIONS 1 ── N SUBMISSION_QUESTION_APPLICABILITY
SURVEY_APPLICABILITY_RULES 1 ── N SUBMISSION_QUESTION_APPLICABILITY (opcional)

EVALUATION_CONFIGURATIONS 1 ── N EVALUATION_STAR_RANGES
SURVEY_SUBMISSIONS 1 ── 0..1 EVALUATION_RESULTS
EVALUATION_CONFIGURATIONS 1 ── N EVALUATION_RESULTS (opcional desde result)
EVALUATION_RESULTS 1 ── N EVALUATION_DIMENSION_RESULTS
SURVEY_DIMENSIONS 1 ── N EVALUATION_DIMENSION_RESULTS
```

Para Draw.io, usar línea sólida para las FKs de la sección 3 y línea discontinua con etiqueta **«relación inferida»** para las once dependencias lógicas. Resaltar en color principal `schools`, `survey_versions`, `campaigns`, `survey_submissions` y `evaluation_results`; colocar tablas puente entre sus dos principales; agrupar catálogos, seguridad y auditoría en zonas auxiliares. No dibujar módulos sin tabla (`dashboard`, `exports`, `reports`, `mail`, `health`) ni inventar entidades de archivos/permisos.
