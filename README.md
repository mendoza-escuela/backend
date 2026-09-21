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
- `ThrottlerGuard` se aplica globalmente: el límite general es de 100 solicitudes por minuto e incluye límites más estrictos en login y recuperación de contraseña.
- Toda solicitud `POST`, `PUT`, `PATCH` o `DELETE` del navegador debe enviar `X-CSRF-Protection: 1`. La API rechaza orígenes distintos de `FRONTEND_URL`; el cliente Axios central agrega la cabecera automáticamente.
- `FRONTEND_URL` debe ser un origen HTTP(S) exacto, sin rutas. No usar comodines con credenciales.
- Si producción utiliza Nginx u otro proxy, configurar `TRUST_PROXY_HOPS` con la cantidad exacta de saltos confiables para que el rate limiting identifique correctamente la IP del cliente. No habilitarlo cuando la API esté expuesta directamente.
- Cada JWT referencia una sesión persistida que puede revocarse al cerrar sesión o recuperar la contraseña.
- Las sesiones con rol `school` exigen una asociación vigente con una escuela activa; la baja revoca sus SIDs y la reactivación requiere un login nuevo.
- Cinco intentos fallidos bloquean temporalmente la cuenta durante 15 minutos por defecto.
- Los tokens de recuperación se almacenan hasheados, vencen y son de un solo uso.
- El cambio desde perfil valida la contraseña actual y revoca las demás sesiones.
- Los recursos privados deben combinar `JwtAuthGuard`, `PasswordChangeRequiredGuard` y `RolesGuard`. Los recursos con `:schoolId` deben agregar `SchoolAccessGuard` para impedir acceso entre colegios.

## SMTP

El flujo queda implementado, pero el envío real solo es operativo si `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` están configurados; `SMTP_PORT` usa 587 por defecto. Nunca se debe versionar `.env` ni registrar tokens o credenciales.

Al crear una cuenta, el sistema intenta enviar un correo HTML responsive con el usuario, la contraseña temporal, la URL de acceso y los pasos del primer ingreso. La contraseña se utiliza únicamente para construir ese mensaje y en la base de datos se conserva solo su hash. La cuenta exige cambiarla durante el primer acceso.

El envío ocurre después de confirmar el alta. Si SMTP no está configurado o el proveedor rechaza el mensaje, la cuenta permanece creada y la API devuelve `invitationEmailSent: false`; el panel administrativo advierte que las credenciales deben entregarse por otro canal seguro. La importación masiva informa también cuántos correos fueron enviados y cuántos quedaron pendientes.

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

Las rutas protegidas bajo `/admin/schools` permiten alta, listado paginado, búsqueda por CUE/nombre/número, filtros territoriales e institucionales, detalle, edición, activación y desactivación. El detalle incluye el usuario Colegio, accesos recientes, historial de asociaciones, auditoría, etapas asignadas y resultados disponibles; no se generan datos ficticios.

Cada colegio admite un único usuario con rol `school`, y cada usuario sólo puede pertenecer a un colegio. Los reemplazos y desvinculaciones conservan un historial independiente. Un colegio inactivo conserva sus datos e historial, bloquea nuevos logins y cargas, y revoca transaccionalmente las sesiones escolares vigentes. La reactivación exige un login nuevo. El diseño, la concurrencia y los datos preservados se documentan en [`docs/school-deactivation.md`](docs/school-deactivation.md).

`GET /api/admin/schools` pagina en PostgreSQL mediante `page` y `limit` y selecciona únicamente las columnas del listado. `GET /api/admin/schools/:id/assignable-users` busca y pagina usuarios disponibles para asociación en backend, evitando descargar cuentas ocupadas y filtrarlas en el navegador.

`GET /api/admin/schools/:id` devuelve en `campaigns.items` sólo las
asignaciones vigentes, ordenadas por inicio de etapa y fecha de asignación
descendentes. Cada elemento incluye la etapa, la trazabilidad de asignación,
el estado excluyente `not_started`, `draft` o `submitted`, la presentación y la
disponibilidad del resultado. `evaluations.items` resume los resultados
persistidos con `campaignId`, `submissionId`, puntaje, estrellas y fecha de
cálculo. Ambos bloques usan `available: true`, incluso cuando no tienen filas;
los IDs permiten construir enlaces de seguimiento y detalle sin exponer rutas
del frontend desde la API. La consulta se resuelve con joins y no ejecuta una
consulta adicional por etapa.

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

`GET /api/schools/me/rectification/catalogs` devuelve los catálogos de jornadas y niveles desde backend, incluidos los valores inactivos necesarios para representar el historial. También expone Sector/Gestión, Ámbito, Tipo de educación y Características con códigos estables. La migración `SeedOfficialSchoolCatalogs1720375221000` carga las seis jornadas y los cuatro niveles provistos y sólo vincula datos históricos cuando existe una coincidencia normalizada inequívoca. El endpoint informa explícitamente si alguno de los catálogos persistidos no está disponible.

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

Las versiones borrador no se exponen a las escuelas. Las etapas y respuestas pertenecen a los módulos `campaigns` y `submissions`; `surveys` conserva exclusivamente la definición versionada e inmutable.

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

La importación institucional admite exclusivamente preguntas de selección simple, no genera ni permite “Otro” o “No aplica” y valida desde una política central las escalas `100/50/0` para las dimensiones generales y `100/66/33/0` para Salud Mental. La matriz confirmada aplica `100/50/0` a las ternarias generales, `100/0` a p022, p023 y p025, y `0/33/66/100` a p052. p038 y las preguntas mentales de tres opciones permanecen bloqueadas sin puntajes hasta contar con el mapeo del cliente. La columna `condicion` se incluye como reserva, pero debe permanecer vacía hasta contar con el modelo formal de reglas; no se persiste texto opaco que el motor de evaluación no pueda ejecutar.

La planilla consolidada de 60 preguntas se versiona en `docs/plantilla-cuestionario-completo.xlsx` y se regenera con `npm run survey:generate-official-template`. Incorpora las correcciones funcionales cerradas para p010, p020, p032 y p046, incluye una hoja con el inventario completo de puntuación y se valida contra el importador real. La validación debe rechazar solamente los puntajes aún no definidos de p038 y las 16 preguntas mentales ternarias; la planilla no es importable hasta resolverlos. Las decisiones de contenido, puntuación y aplicabilidad se documentan en [`docs/cuestionario-oficial-sur02.md`](docs/cuestionario-oficial-sur02.md).

SUR-04 exige que las 60 preguntas del banco institucional se publiquen como obligatorias y que cada pregunta aplicable tenga respuesta antes del envío final. Las excluidas quedan fuera de la completitud; los cuestionarios personalizados conservan sus preguntas opcionales y usan códigos distintos del espacio reservado oficial. La política, el comportamiento transaccional y sus regresiones se documentan en [`docs/questionnaire-required-answers.md`](docs/questionnaire-required-answers.md).

SUR-05 centraliza las escalas institucionales `100/50/0` y `100/66/33/0`, valida la secuencia exacta por código antes de publicar y mantiene bloqueados, sin inferencias, `p038` y los dieciséis mapeos mentales todavía no definidos por el cliente. La matriz y las decisiones pendientes se documentan en [`docs/official-survey-scoring.md`](docs/official-survey-scoring.md).

Publicar es una operación irreversible: el servicio impide editar o eliminar la versión y la migración `ProtectPublishedSurveyVersions1720375206000` agrega triggers PostgreSQL que también protegen la versión y todos sus descendientes ante escrituras por fuera de la API. Para cambiar contenido publicado debe clonarse como una versión borrador nueva.

Cada cuestionario admite una sola versión vigente. Al publicar un borrador, el backend bloquea el cuestionario, archiva automáticamente la versión publicada anterior y publica la nueva dentro de la misma transacción. Ambas transiciones se auditan con un `publicationOperationId` común. La migración `EnforceSinglePublishedSurveyVersion1720375218000` detecta inconsistencias existentes y agrega un índice único parcial para impedir más de una fila `published` por cuestionario incluso ante escrituras concurrentes.

El archivado manual se conserva para retirar una versión sin reemplazarla. Las etapas mantienen su `survey_version_id`: una versión archivada continúa disponible de forma inmutable para etapas, presentaciones y resultados históricos, pero no puede seleccionarse al crear una etapa nueva.

Las altas, cambios, clonaciones, publicaciones y bajas se registran en `audit_logs` con usuario, fecha, entidad y resumen del cambio. No se guardan secretos ni contenido de respuestas.

## Administración de etapas

Las rutas bajo `/api/admin/campaigns` requieren rol `admin`. Permiten listar, crear, consultar, editar y eliminar etapas borrador, además de ejecutar el ciclo irreversible `draft → active → closed → archived`.

Cada etapa es anual o semestral y referencia obligatoriamente una versión publicada de un cuestionario activo. Al activarse, su configuración queda protegida; sólo los borradores pueden editarse o eliminarse. `GET /api/admin/campaigns/survey-versions` devuelve las versiones habilitadas para el selector administrativo.

Una etapa puede ser independiente o integrar un recorrido mediante `workflowCycle` y `sequenceOrder`. Varias etapas del mismo recorrido pueden permanecer activas simultáneamente, pero cada escuela sólo puede iniciar, guardar o enviar una etapa cuando ya envió todas las etapas anteriores que tiene asignadas. Las etapas anteriores no asignadas a esa escuela se omiten. `GET /api/admin/campaigns/workflows` lista los recorridos existentes y su último orden; la combinación recorrido/orden es única sin distinguir mayúsculas. Las etapas existentes al aplicar la migración permanecen independientes para no crear dependencias históricas artificiales.

Las fechas ingresan como fechas civiles `AAAA-MM-DD`. El inicio se almacena a las `00:00:00` y el cierre a las `23:59:59.999` de Mendoza (`America/Argentina/Mendoza`, UTC-3). Un proceso periódico cierra las etapas activas vencidas y registra el evento en `audit_logs`; el valor de `closed_at` conserva el instante exacto configurado, aunque la detección ocurra unos segundos después.

La migración `AddCampaignManagement1720375211000` crea la tabla, enumeraciones, índice de estado/fechas y la relación protegida con `survey_versions`.

### Selección de escuelas por etapa

Los endpoints `GET /api/admin/campaigns/:id/schools` y `/schools/options`
ofrecen listados paginados. `POST /schools/preview` anticipa el alcance y
`POST /schools/assign` aplica una selección manual, por filtros o masiva;
`DELETE /schools/:schoolId` realiza una baja lógica. Estas operaciones están
auditadas. Las altas y su vista previa están habilitadas en etapas borrador
y activas no vencidas; durante una activa sólo se incorporan escuelas
habilitadas. Las bajas continúan limitadas a borrador y una asignación con una
presentación existente no puede quitarse. El detalle se documenta en
[`docs/campaign-active-school-assignment.md`](docs/campaign-active-school-assignment.md).

La activación exige una versión publicada y al menos una asignación vigente.
El portal escolar, presentaciones, seguimiento, participación, resultados y
exportaciones parten siempre de `campaign_schools`.

## Presentaciones y borradores escolares

`GET /api/school/campaigns` lista para el usuario Escuela sólo las etapas
activas, abiertas y asignadas explícitamente a su establecimiento mediante
`campaign_schools`. La respuesta distingue si existe confirmación anual
(`isConfirmed`) de si su snapshot está listo para evaluar
(`isEvaluationReady`), informa `missingFields` para una confirmación incompleta
y conserva `isRectified` temporalmente como alias de compatibilidad. El bloque
`expiredDrafts` mantiene localizables los borradores de etapas finalizadas,
incluso si la asignación fue retirada, y excluye etapas futuras y
presentaciones enviadas.

El `GET` del workspace abre esos borradores en modo de sólo lectura: utiliza
las decisiones de aplicabilidad congeladas o las reconstruye únicamente en
memoria desde el snapshot histórico. No adopta una rectificación posterior ni
actualiza respuestas, decisiones o auditoría. Los endpoints de guardado y
envío continúan rechazando cualquier etapa fuera de su período operativo.

Para etapas ordenadas, cada elemento operativo informa `workflowStatus`, `blockedBy` y `blockingReason`. La precedencia se valida nuevamente en backend al crear o recuperar la presentación, guardar un borrador y realizar el envío final; deshabilitar controles en el frontend no constituye la protección de negocio.

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

La escuela se obtiene siempre de la asociación del usuario autenticado. El primer borrador exige establecimiento activo, confirmación anual y un snapshot listo para evaluar; posteriores usuarios asociados a la misma escuela recuperan ese borrador porque la unicidad se define por `school_id + campaign_id`. También se conserva un snapshot del usuario que inició la carga.

Cada presentación referencia la versión publicada fijada por la etapa. Las respuestas enviadas son inmutables en el servicio y mediante triggers PostgreSQL. La migración `AddSurveySubmissions1720375212000` crea presentaciones, respuestas, índices, relaciones y protecciones de integridad.

## Dashboard administrativo de participación

Las rutas bajo `/api/admin/dashboard/participation` requieren rol `admin`. `GET /api/admin/dashboard/participation/filters` devuelve etapas activas, cerradas o archivadas y las opciones de las escuelas con asignación vigente en la etapa. Departamento y localidad limitan las localidades y escuelas disponibles.

`GET /api/admin/dashboard/participation?campaignId=:uuid` calcula en PostgreSQL, desde una única consulta agregada, el total de escuelas con asignación vigente, las no iniciadas, los borradores, los envíos y el porcentaje de envíos sobre ese universo. Los filtros territoriales, escolares, institucionales, de estado, estrellas y áreas críticas admiten multiselección; usan OR dentro de una categoría y AND entre categorías. Una escuela sin presentación se considera no iniciada; los estados persistidos `draft` y `submitted` determinan los otros dos grupos. Si el total es cero, el porcentaje devuelto es cero. El contrato, las claves plurales y la compatibilidad con las claves anteriores se documentan en [`docs/dashboard-multiselect-filters.md`](docs/dashboard-multiselect-filters.md).

`GET /api/admin/dashboard/results/comparison` compara de dos a seis etapas en el orden solicitado, con filtros institucionales multiselección y denominadores independientes por período. Los filtros de estado, estrellas y áreas críticas se excluyen para no seleccionar la población por su propio resultado. Puntaje general y distribución de estrellas son las métricas históricas estandarizadas; la trayectoria dimensional se habilita sólo para una escuela y declara si es comparable o meramente descriptiva según la versión del cuestionario, algoritmo y configuración persistidos. El contrato y las decisiones funcionales se documentan en [`docs/dashboard-period-comparison.md`](docs/dashboard-period-comparison.md).

Las etapas en borrador quedan fuera del seguimiento. Los denominadores y
resultados comienzan en `campaign_schools`, por lo que conservan el universo
administrativamente asignado y no incorporan todo el padrón activo.

La migración `AddSubmissionApplicabilityDecisions1720375214000` conserva por pregunta el estado resuelto, la regla aplicada, el código y descripción del motivo, la fecha y los hechos escolares relevantes. Los borradores adoptan la rectificación vigente cuando cambia y recalculan contra ese snapshot; los envíos consultan las decisiones congeladas y nunca la ficha escolar actual. Las preguntas excluidas quedan fuera de la completitud y del contrato entregado al cálculo, por lo que no suman cero ni modifican denominadores.

## Exportaciones y reportes

`GET /api/admin/exports/results` y `GET /api/admin/exports/answers` aceptan
`campaignId`, los filtros del dashboard y `format=csv|xlsx`. CSV se escribe por
streaming y XLSX usa `WorkbookWriter`; ambos recorren lotes de 100 escuelas y
neutralizan celdas que, aun tras espacios o caracteres de control, comienzan
con `=`, `+`, `-` o `@`. Las respuestas y textos
provienen del snapshot de evaluación, no del cuestionario vigente. La
auditoría conserva filtros, estado y cantidad de filas, nunca el contenido
exportado.

Los reportes históricos se descargan desde:

- `GET /api/school/campaigns/:id/submission/report.pdf`
- `GET /api/school/campaigns/:id/submission/receipt.pdf`
- `GET /api/school/campaigns/:id/submission/report.xlsx`
- `GET /api/admin/campaigns/:campaignId/schools/:schoolId/report.pdf`

El XLSX escolar reúne `Resumen`, `Dimensiones`, `Respuestas` y `Exclusiones`
desde el snapshot histórico del envío. La escuela se resuelve exclusivamente
desde su sesión, la descarga exige una presentación enviada con resultado y
queda auditada; el cliente nunca envía un `schoolId`. Las respuestas residuales
de preguntas excluidas no se incluyen.

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
