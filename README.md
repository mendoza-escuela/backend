# Backend - Escuelas Promotoras de Salud

API NestJS con PostgreSQL y TypeORM.

Todos los endpoints HTTP se publican bajo el prefijo `/api` (por ejemplo, `POST /api/auth/login`).

## Puesta en marcha local

1. Copiar `.env.example` a `.env` y completar secretos.
2. Iniciar PostgreSQL con `npm run db:up`.
3. Ejecutar `npm run migration:run`.
4. Completar `INITIAL_ADMIN_EMAIL` e `INITIAL_ADMIN_PASSWORD` en `.env`.
5. Crear el administrador inicial con `npm run seed:admin`.
6. Iniciar la API con `npm run start:dev`.

El seed es idempotente, asigna el rol `admin` y obliga a cambiar la contraseña en el primer acceso. La contraseña inicial debe tener al menos 12 caracteres, mayúscula, minúscula, número y símbolo.

## Despliegue en producción

`npm run start:prod` ejecuta primero todas las migraciones pendientes y solo inicia la API cuando terminan correctamente. La imagen Docker usa este mismo comando, por lo que cada despliegue actualiza automáticamente el esquema. Un bloqueo transaccional de PostgreSQL evita que varias réplicas intenten migrar simultáneamente.

Si una migración falla, el proceso termina con error y la API no arranca con un esquema incompleto. Las migraciones deben mantener operaciones compatibles con despliegues graduales cuando se ejecuten varias réplicas de la aplicación.

El seed del administrador no forma parte del arranque automático: debe ejecutarse una sola vez mediante `npm run seed:admin`.

## Seguridad de autenticación

- El JWT se entrega en una cookie `HttpOnly`, `Secure`, `SameSite=None` y particionada en producción, porque el frontend y la API se publican en hosts distintos.
- Cada JWT referencia una sesión persistida que puede revocarse al cerrar sesión o recuperar la contraseña.
- Cinco intentos fallidos bloquean temporalmente la cuenta durante 15 minutos por defecto.
- Los tokens de recuperación se almacenan hasheados, vencen y son de un solo uso.
- El cambio desde perfil valida la contraseña actual y revoca las demás sesiones.
- Los recursos privados deben combinar `JwtAuthGuard`, `PasswordChangeRequiredGuard` y `RolesGuard`. Los recursos con `:schoolId` deben agregar `SchoolAccessGuard` para impedir acceso entre colegios.

## SMTP

El flujo queda implementado, pero el envío real solo es operativo si `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` están configurados. Nunca se debe versionar `.env` ni registrar tokens o credenciales.

## Administración de usuarios

Las rutas bajo `/admin/users` requieren sesión válida, contraseña inicial ya cambiada y rol `admin`. Incluyen listado paginado, búsqueda y filtros, alta, edición, bloqueo, desbloqueo y restablecimiento administrativo de contraseña.

Las operaciones sensibles generan registros en `audit_logs`. Nunca se guardan contraseñas ni hashes dentro del detalle de auditoría. Bloquear una cuenta o restablecer su contraseña revoca sus sesiones activas.

El selector de colegio consulta `GET /api/admin/users/schools?search=texto&page=1&limit=20`. La búsqueda por CUE, número o nombre se procesa en PostgreSQL, devuelve una respuesta paginada y utiliza índices trigram creados por la migración `AddSchoolSearchIndexes1720375207000`; el frontend no descarga el padrón completo.

`GET /api/admin/users` pagina en base de datos mediante `page` y `limit` (20 por defecto, máximo 100), aplica búsqueda y filtros antes de `skip/take` y devuelve únicamente los campos necesarios para la grilla. La migración `AddUserSearchIndexes1720375208000` agrega índices para nombre, apellido y correo. La importación consulta solamente los CUE incluidos en el archivo, nunca el padrón completo.

La importación masiva acepta archivos `.csv` o `.xlsx` de hasta 2 MB y 500 filas. La plantilla se descarga desde `GET /admin/users/import/template` y utiliza estas columnas:

```text
nombre,apellido,correo,rol,colegio_cue,contrasena_temporal,estado
```

Primero debe ejecutarse la vista previa. La importación es parcial: crea las filas válidas y devuelve los errores de las filas rechazadas.

## Administración de colegios

Las rutas protegidas bajo `/admin/schools` permiten alta, listado paginado, búsqueda por CUE/nombre/número, filtros territoriales e institucionales, detalle, edición, activación y desactivación. El detalle incluye el usuario Colegio, accesos recientes, historial de asociaciones y auditoría. Campañas y evaluaciones se informan explícitamente como no disponibles hasta que existan esos módulos; no se generan datos ficticios.

Cada colegio admite un único usuario con rol `school`, y cada usuario sólo puede pertenecer a un colegio. Los reemplazos y desvinculaciones conservan un historial independiente. Un colegio inactivo conserva sus datos e historial; `SchoolsService.assertActiveForEvaluation` es la validación obligatoria que deberá usar el módulo de evaluaciones antes de crear una nueva.

`GET /api/admin/schools` pagina en PostgreSQL mediante `page` y `limit` y selecciona únicamente las columnas del listado. `GET /api/admin/schools/:id/assignable-users` busca y pagina usuarios disponibles para asociación en backend, evitando descargar cuentas ocupadas y filtrarlas en el navegador.

La importación acepta CSV/XLSX de hasta 2 MB y 500 filas, ofrece vista previa y realiza importación parcial. La plantilla se obtiene en `GET /admin/schools/import/template`. El padrón filtrado puede exportarse mediante `GET /admin/schools/export?format=csv` o `format=xlsx`; cada exportación queda auditada.

Columnas de la plantilla de colegios (los campos del segundo referente son
opcionales):

```text
cue,nombre,director,numero,departamento,localidad,direccion,codigo_postal,nivel,gestion,ambito,jornada,telefono,correo,referente_nombre,referente_apellido,referente_cargo,referente_correo,referente_telefono,salud_referente_nombre,salud_referente_apellido,salud_referente_cargo,salud_referente_correo,salud_referente_telefono,matricula,caracteristicas,estado
```

`caracteristicas` debe ser un objeto JSON con hasta 30 valores simples, por ejemplo `{"comedor":true}`.
Los referentes se guardan en `school_contacts` como `RESPONDENT` y
`HEALTH_PROMOTION`; no son usuarios ni reciben credenciales automáticamente.
Las columnas históricas del referente principal se mantienen temporalmente
sincronizadas para compatibilidad.

## Portal del establecimiento

`GET /api/schools/me` requiere rol `school` y devuelve únicamente el establecimiento asociado al usuario autenticado. La consulta no acepta un identificador enviado por el navegador, por lo que un usuario Escuela no puede seleccionar ni consultar otro establecimiento.

`PUT /api/schools/me/rectification` permite revisar y rectificar la ficha obligatoria del establecimiento asociado para el año calendario vigente. La operación conserva un snapshot autocontenido con período, fecha, usuario, características ternarias, jornada catalogada, niveles y matrículas, y registra auditoría. `expectedUpdatedAt` permite detectar una edición concurrente. Los administradores conservan el endpoint existente `PUT /api/admin/schools/:id/rectification`.

`GET /api/schools/me/rectification/catalogs` devuelve los catálogos de jornadas y niveles desde backend, incluidos los valores inactivos necesarios para representar el historial. La migración crea la infraestructura sin precargar valores: los códigos y etiquetas productivos siguen pendientes del catálogo oficial del programa. El endpoint informa explícitamente cuando un catálogo está vacío.

Al iniciar una presentación se vincula la última rectificación del año vigente y se copia su snapshot en `survey_submissions`. Mientras la presentación es borrador puede adoptar una rectificación posterior, recalcular la aplicabilidad y conservar las respuestas que queden excluidas. Al enviarse, el vínculo, el snapshot y las decisiones quedan inmutables para preservar el historial.

## Cuestionarios versionados

El módulo `surveys` modela la estructura `cuestionario → versión → dimensión → sección → pregunta → opción`. Cada nivel posee códigos y órdenes únicos dentro de su contenedor. Las versiones admiten los estados `draft`, `published` y `archived`; una versión publicada requiere fecha de publicación.

Tipos de pregunta disponibles:

```text
single_choice, multiple_choice, boolean, short_text, long_text, number, date
```

Las reglas básicas de presentación (`min`, `max`, longitudes, máximo de selecciones y placeholder) se almacenan en cada pregunta. Las opciones admiten un puntaje entero entre 0 y 100. La columna es nullable únicamente para conservar sin inventar valores en datos anteriores a la migración; toda opción debe tener puntaje antes de publicar una versión nueva. Las condiciones y exclusiones se resuelven al abrir una presentación; la clasificación por estrellas continúa separada de este flujo.

Endpoints de lectura protegidos para roles `admin` y `school`:

- `GET /api/surveys/available`: lista cuestionarios activos con una versión publicada.
- `GET /api/surveys/available/:code`: devuelve la última versión publicada con toda su estructura ordenada.

Las versiones borrador no se exponen a las escuelas. Las campañas y respuestas pertenecen a los módulos `campaigns` y `submissions`; `surveys` conserva exclusivamente la definición versionada e inmutable.

### Administración de cuestionarios

Las rutas bajo `/api/admin/surveys` requieren sesión válida, contraseña inicial ya cambiada y rol `admin`:

- `GET /api/admin/surveys?page=1&limit=20&search=texto` y `GET /api/admin/surveys/:surveyId`: listado paginado, detalle, versiones y auditoría reciente.
- `POST /api/admin/surveys`, `PATCH /api/admin/surveys/:surveyId` y `DELETE /api/admin/surveys/:surveyId`: ABM de la definición general.
- `GET /api/admin/surveys/templates/official-dimensions`: catálogo central de las seis dimensiones oficiales y la reasignación de las preguntas 41 a 43 a Salud Mental.
- `GET /api/admin/surveys/import/template?format=xlsx|csv`: descarga la plantilla de carga con instrucciones y códigos oficiales.
- `POST /api/admin/surveys/:surveyId/import/preview`: valida un archivo CSV/XLSX y devuelve errores por fila sin guardar datos.
- `POST /api/admin/surveys/:surveyId/import`: vuelve a validar el archivo y crea atómicamente una versión borrador; nunca modifica una versión existente.
- `POST /api/admin/surveys/:surveyId/versions`: alta de una versión con la plantilla `official_dimensions` (predeterminada), vacía con `blank` o clonada con `sourceVersionId`.
- `GET`, `PUT` y `DELETE /api/admin/surveys/:surveyId/versions/:versionId`: consulta y ABM de una versión borrador.
- `POST /api/admin/surveys/:surveyId/versions/:versionId/publish`: publicación definitiva.
- `GET /api/admin/surveys/:surveyId/versions/:versionId/validation`: validación previa con todos los errores estructurales detectados.
- `GET /api/admin/surveys/:surveyId/versions/compare`: comparación estructural mediante `fromVersionId` y `toVersionId`.

Los borradores pueden guardarse incompletos para permitir construcción progresiva. Antes de publicar se exige, como mínimo, una dimensión, una sección por dimensión, una pregunta por sección, opciones para las preguntas de selección y puntaje en cada opción. En todos los guardados se controlan códigos repetidos, tipos incompatibles con opciones, puntajes fuera de 0–100 y rangos de validación inconsistentes.

La plantilla `official_dimensions` crea únicamente el esqueleto aprobado: nombres, descripciones, códigos internos y orden de las seis dimensiones. No precarga secciones ni preguntas. “Entorno Socioemocional” no se registra como una séptima dimensión; las preguntas 41, 42 y 43 quedan identificadas para su futura carga dentro de `salud_mental`.

La importación institucional admite exclusivamente preguntas de selección simple, no genera ni permite “Otro” o “No aplica” y valida las escalas `100/50/0` para las dimensiones generales y `100/66/33/0` para Salud Mental. La columna `condicion` se incluye como reserva, pero debe permanecer vacía hasta contar con el modelo formal de reglas; no se persiste texto opaco que el motor de evaluación no pueda ejecutar.

Publicar es una operación irreversible: el servicio impide editar o eliminar la versión y la migración `ProtectPublishedSurveyVersions1720375206000` agrega triggers PostgreSQL que también protegen la versión y todos sus descendientes ante escrituras por fuera de la API. Para cambiar contenido publicado debe clonarse como una versión borrador nueva.

Cada cuestionario admite una sola versión vigente. Al publicar un borrador, el backend bloquea el cuestionario, archiva automáticamente la versión publicada anterior y publica la nueva dentro de la misma transacción. Ambas transiciones se auditan con un `publicationOperationId` común. La migración `EnforceSinglePublishedSurveyVersion1720375218000` detecta inconsistencias existentes y agrega un índice único parcial para impedir más de una fila `published` por cuestionario incluso ante escrituras concurrentes.

El archivado manual se conserva para retirar una versión sin reemplazarla. Las campañas mantienen su `survey_version_id`: una versión archivada continúa disponible de forma inmutable para campañas, presentaciones y resultados históricos, pero no puede seleccionarse al crear una campaña nueva.

Las altas, cambios, clonaciones, publicaciones y bajas se registran en `audit_logs` con usuario, fecha, entidad y resumen del cambio. No se guardan secretos ni contenido de respuestas.

## Administración de campañas

Las rutas bajo `/api/admin/campaigns` requieren rol `admin`. Permiten listar, crear, consultar, editar y eliminar campañas borrador, además de ejecutar el ciclo irreversible `draft → active → closed → archived`.

Cada campaña es anual o semestral y referencia obligatoriamente una versión publicada de un cuestionario activo. Al activarse, su configuración queda protegida; sólo los borradores pueden editarse o eliminarse. `GET /api/admin/campaigns/survey-versions` devuelve las versiones habilitadas para el selector administrativo.

Las fechas ingresan como fechas civiles `AAAA-MM-DD`. El inicio se almacena a las `00:00:00` y el cierre a las `23:59:59.999` de Mendoza (`America/Argentina/Mendoza`, UTC-3). Un proceso periódico cierra las campañas activas vencidas y registra el evento en `audit_logs`; el valor de `closed_at` conserva el instante exacto configurado, aunque la detección ocurra unos segundos después.

La migración `AddCampaignManagement1720375211000` crea la tabla, enumeraciones, índice de estado/fechas y la relación protegida con `survey_versions`.

### Selección de escuelas por campaña

Los endpoints `GET /api/admin/campaigns/:id/schools` y `/schools/options`
ofrecen listados paginados. `POST /schools/preview` anticipa el alcance y
`POST /schools/assign` aplica una selección manual, por filtros o masiva;
`DELETE /schools/:schoolId` realiza una baja lógica. Estas operaciones están
limitadas a campañas borrador y quedan auditadas. Una asignación con una
presentación existente no puede quitarse.

La activación exige una versión publicada y al menos una asignación vigente.
El portal escolar, presentaciones, seguimiento, participación, resultados y
exportaciones parten siempre de `campaign_schools`.

## Presentaciones y borradores escolares

`GET /api/school/campaigns` lista para el usuario Escuela sólo las campañas
activas, abiertas y asignadas explícitamente a su establecimiento mediante
`campaign_schools`. La respuesta informa si la ficha está rectificada para el
año vigente y el motivo que impide iniciar, cuando corresponda.

El seguimiento administrativo se expone mediante
`GET /api/admin/campaigns/:id/tracking/summary` y
`GET /api/admin/campaigns/:id/tracking`. Conserva únicamente los estados
`not_started`, `draft` y `submitted`, ejecuta búsqueda, filtros, ordenamiento y
paginación en PostgreSQL, y mantiene visibles escuelas y usuarios inactivos.
El universo abierto y las fórmulas se documentan en
[`docs/campaign-tracking.md`](docs/campaign-tracking.md).

El flujo escolar utiliza:

- `POST /api/school/campaigns/:campaignId/submission`: crea o recupera la presentación única de la escuela.
- `GET /api/school/campaigns/:campaignId/submission`: evalúa en lote la aplicabilidad contra el snapshot rectificado vinculado y recupera únicamente la estructura aplicable, sus respuestas, progreso, exclusiones y datos escolares faltantes.
- `PUT /api/school/campaigns/:campaignId/submission/draft`: reemplaza atómicamente sólo las respuestas aplicables del borrador. Las respuestas anteriores de preguntas excluidas se conservan sin participar en la validación.
- `POST /api/school/campaigns/:campaignId/submission/submit`: reevalúa aplicabilidad, bloquea datos escolares faltantes, valida únicamente preguntas aplicables y realiza el envío definitivo.

La escuela se obtiene siempre de la asociación del usuario autenticado. El primer borrador exige establecimiento activo y rectificación anual; posteriores usuarios asociados a la misma escuela recuperan ese borrador porque la unicidad se define por `school_id + campaign_id`. También se conserva un snapshot del usuario que inició la carga.

Cada presentación referencia la versión publicada fijada por la campaña. Las respuestas enviadas son inmutables en el servicio y mediante triggers PostgreSQL. La migración `AddSurveySubmissions1720375212000` crea presentaciones, respuestas, índices, relaciones y protecciones de integridad.

## Dashboard administrativo de participación

Las rutas bajo `/api/admin/dashboard/participation` requieren rol `admin`. `GET /api/admin/dashboard/participation/filters` devuelve campañas activas, cerradas o archivadas y las opciones del padrón activo. Departamento y localidad limitan las localidades y escuelas disponibles.

`GET /api/admin/dashboard/participation?campaignId=:uuid` calcula en PostgreSQL, desde una única consulta agregada, el total de escuelas activas, las no iniciadas, los borradores, los envíos y el porcentaje de envíos sobre el total. Admite los filtros `department`, `locality`, `schoolId`, `educationLevel`, `managementType`, `scope` y `shift`. Una escuela sin presentación se considera no iniciada; los estados persistidos `draft` y `submitted` determinan los otros dos grupos. Si el total es cero, el porcentaje devuelto es cero.

Las campañas en borrador quedan fuera del seguimiento. Los denominadores y
resultados comienzan en `campaign_schools`, por lo que conservan el universo
administrativamente asignado y no incorporan todo el padrón activo.

La migración `AddSubmissionApplicabilityDecisions1720375214000` conserva por pregunta el estado resuelto, la regla aplicada, el código y descripción del motivo, la fecha y los hechos escolares relevantes. Los borradores adoptan la rectificación vigente cuando cambia y recalculan contra ese snapshot; los envíos consultan las decisiones congeladas y nunca la ficha escolar actual. Las preguntas excluidas quedan fuera de la completitud y del contrato entregado al cálculo, por lo que no suman cero ni modifican denominadores.

## Exportaciones y reportes

`GET /api/admin/exports/results` y `GET /api/admin/exports/answers` aceptan
`campaignId`, los filtros del dashboard y `format=csv|xlsx`. CSV se escribe por
streaming y XLSX usa `WorkbookWriter`; ambos recorren lotes de 100 escuelas y
neutralizan celdas iniciadas con `=`, `+`, `-` o `@`. Las respuestas y textos
provienen del snapshot de evaluación, no del cuestionario vigente. La
auditoría conserva filtros, estado y cantidad de filas, nunca el contenido
exportado.

Los reportes históricos se descargan desde:

- `GET /api/school/campaigns/:id/submission/report.pdf`
- `GET /api/school/campaigns/:id/submission/receipt.pdf`
- `GET /api/admin/campaigns/:campaignId/schools/:schoolId/report.pdf`

El radar es SVG determinístico generado en backend. Logos, firmante, firma,
texto legal y verificación se configuran con las variables `REPORT_*`; si no
hay assets oficiales válidos se usa identificación textual.

La distribución general de estrellas para escuelas está preparada en
`GET /api/school/campaigns/:campaignId/star-distribution`, pero permanece
desactivada con `SCHOOL_STAR_DISTRIBUTION_ENABLED=false`. Antes de habilitarla
debe confirmarse el alcance provincial/departamental y el mínimo de muestra.

## Verificación

```bash
npm run lint
npm test
npm run build
npm run migration:run
```
