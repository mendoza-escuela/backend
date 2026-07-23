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

Columnas de la plantilla de colegios:

```text
cue,nombre,numero,departamento,localidad,direccion,codigo_postal,nivel,gestion,ambito,jornada,telefono,correo,referente_nombre,referente_apellido,referente_correo,referente_telefono,matricula,caracteristicas,estado
```

`caracteristicas` debe ser un objeto JSON con hasta 30 valores simples, por ejemplo `{"comedor":true}`.

## Portal del establecimiento

`GET /api/schools/me` requiere rol `school` y devuelve únicamente el establecimiento asociado al usuario autenticado. La consulta no acepta un identificador enviado por el navegador, por lo que un usuario Escuela no puede seleccionar ni consultar otro establecimiento.

## Cuestionarios versionados

El módulo `surveys` modela la estructura `cuestionario → versión → dimensión → sección → pregunta → opción`. Cada nivel posee códigos y órdenes únicos dentro de su contenedor. Las versiones admiten los estados `draft`, `published` y `archived`; una versión publicada requiere fecha de publicación.

Tipos de pregunta disponibles:

```text
single_choice, multiple_choice, boolean, short_text, long_text, number, date
```

Las reglas básicas de presentación y validación (`min`, `max`, longitudes, máximo de selecciones y placeholder) se almacenan separadas de cualquier regla de puntaje. El modelo no incorpora puntajes, estrellas ni condiciones porque esas definiciones funcionales siguen pendientes.

Endpoints de lectura protegidos para roles `admin` y `school`:

- `GET /api/surveys/available`: lista cuestionarios activos con una versión publicada.
- `GET /api/surveys/available/:code`: devuelve la última versión publicada con toda su estructura ordenada.

Las versiones borrador no se exponen a las escuelas. Campañas, borradores de respuestas y envíos finales siguen fuera de este módulo y no se simulan.

### Administración de cuestionarios

Las rutas bajo `/api/admin/surveys` requieren sesión válida, contraseña inicial ya cambiada y rol `admin`:

- `GET /api/admin/surveys?page=1&limit=20&search=texto` y `GET /api/admin/surveys/:surveyId`: listado paginado, detalle, versiones y auditoría reciente.
- `POST /api/admin/surveys`, `PATCH /api/admin/surveys/:surveyId` y `DELETE /api/admin/surveys/:surveyId`: ABM de la definición general.
- `POST /api/admin/surveys/:surveyId/versions`: alta de una versión vacía o clonada con `sourceVersionId`.
- `GET`, `PUT` y `DELETE /api/admin/surveys/:surveyId/versions/:versionId`: consulta y ABM de una versión borrador.
- `POST /api/admin/surveys/:surveyId/versions/:versionId/publish`: publicación definitiva.
- `GET /api/admin/surveys/:surveyId/versions/:versionId/validation`: validación previa con todos los errores estructurales detectados.
- `GET /api/admin/surveys/:surveyId/versions/compare`: comparación estructural mediante `fromVersionId` y `toVersionId`.

Los borradores pueden guardarse incompletos para permitir construcción progresiva. Antes de publicar se exige, como mínimo, una dimensión, una sección por dimensión, una pregunta por sección y opciones para las preguntas de selección. En todos los guardados se controlan códigos repetidos, tipos incompatibles con opciones y rangos de validación inconsistentes.

Publicar es una operación irreversible: el servicio impide editar o eliminar la versión y la migración `ProtectPublishedSurveyVersions1720375206000` agrega triggers PostgreSQL que también protegen la versión y todos sus descendientes ante escrituras por fuera de la API. Para cambiar contenido publicado debe clonarse como una versión borrador nueva.

Las altas, cambios, clonaciones, publicaciones y bajas se registran en `audit_logs` con usuario, fecha, entidad y resumen del cambio. No se guardan secretos ni contenido de respuestas.

## Verificación

```bash
npm run lint
npm test
npm run build
npm run migration:run
```
