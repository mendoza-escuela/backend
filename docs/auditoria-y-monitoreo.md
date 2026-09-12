# Auditoría y supervisión de salud

La auditoría y la supervisión se ejecutan dentro de la API NestJS. No se debe
levantar un contenedor, proceso ni credencial de monitoreo adicional.

## Supervisión interna

Al iniciar y luego cada 60 segundos, el backend comprueba:

- conexión con PostgreSQL;
- respuesta HTTP de `FRONTEND_URL`;
- configuración SMTP;
- cantidad de usuarios activos con rol `admin` que recibirán alertas.

El cambio a un estado degradado y la posterior recuperación generan eventos
`SERVICE_HEALTH_DEGRADED` y `SERVICE_HEALTH_RECOVERED` en la auditoría. Cuando
SMTP está configurado, el backend envía el detalle a cada administrador activo.
La pantalla **Administración > Auditoría y salud** muestra el último resultado.

Las alertas usan las mismas variables SMTP que el alta de usuarios y la
recuperación de contraseña:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

En desarrollo, la aplicación completa se inicia levantando PostgreSQL, backend
y frontend. No se necesita ejecutar nada dentro de `backend/monitoring`.

## Alcance

La supervisión integrada puede detectar fallas de PostgreSQL y del frontend
mientras el proceso de la API continúa activo. Si el propio proceso de la API o
el servidor completo se detienen, no puede enviar un correo desde ese mismo
proceso. Esa cobertura requiere que la infraestructura donde se despliegue
reinicie el contenedor y observe su `healthcheck`.

## Conservación y protección

Los eventos se conservan por un mínimo de 365 días. La migración
`ProtectAuditLogs` instala las protecciones de la tabla. En producción, la API
debe conectarse con una cuenta sin privilegios de propietario; el procedimiento
está en `operations/configure-audit-roles.sql`.
