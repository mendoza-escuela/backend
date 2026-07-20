# Backend - Escuelas Promotoras de Salud

API NestJS con PostgreSQL y TypeORM.

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

- El JWT se entrega en una cookie `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- Cada JWT referencia una sesión persistida que puede revocarse al cerrar sesión o recuperar la contraseña.
- Cinco intentos fallidos bloquean temporalmente la cuenta durante 15 minutos por defecto.
- Los tokens de recuperación se almacenan hasheados, vencen y son de un solo uso.
- El cambio desde perfil valida la contraseña actual y revoca las demás sesiones.
- Los recursos privados deben combinar `JwtAuthGuard`, `PasswordChangeRequiredGuard` y `RolesGuard`. Los recursos con `:schoolId` deben agregar `SchoolAccessGuard` para impedir acceso entre colegios.

## SMTP

El flujo queda implementado, pero el envío real solo es operativo si `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` están configurados. Nunca se debe versionar `.env` ni registrar tokens o credenciales.

## Verificación

```bash
npm run lint
npm test
npm run build
npm run migration:run
```
