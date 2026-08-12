# Baja lógica de escuelas (SCH-05)

La baja de una escuela es lógica: cambia `schools.is_active` y no elimina la
escuela, su usuario asociado ni ningún dato histórico.

## Comportamiento

- El cambio de estado se realiza únicamente mediante
  `PATCH /api/admin/schools/:id/status`.
- Al desactivar, la actualización de la escuela y la revocación de todas las
  sesiones escolares vigentes se ejecutan en la misma transacción.
- Una baja repetida vuelve a conciliar sesiones rezagadas. Si encuentra alguna,
  registra la auditoría `SCHOOL_SESSIONS_REVOKED`.
- Un usuario con rol `school` solo puede iniciar sesión si conserva su relación
  1:1 con una escuela activa.
- Cada validación de una sesión escolar vuelve a comprobar esa relación y el
  estado de la escuela. Si ya no son válidos, revoca el SID presentado y
  responde `401`.
- Al reactivar una escuela no se rehabilitan sesiones anteriores. El usuario
  debe iniciar una sesión nueva.
- Los administradores no dependen del estado de una escuela y conservan acceso
  a consultas, seguimiento y reportes históricos.

## Consistencia concurrente

El login escolar mantiene un bloqueo de lectura sobre la fila `schools` hasta
guardar la nueva `auth_session`. La baja toma un bloqueo de escritura sobre la
misma fila. Así, si ambos procesos coinciden, la baja se ejecuta antes e impide
crear la sesión, o se ejecuta después y revoca la sesión recién creada.

Las transacciones escolares que inician, abren, guardan o envían una
presentación también mantienen un bloqueo de lectura sobre esa fila hasta
terminar. La rectificación toma un bloqueo de escritura y comprueba el estado
después de adquirirlo. Por lo tanto, una carga concurrente termina antes de la
baja o es rechazada después de ella; nunca confirma una escritura nueva detrás
de una baja ya completada.

La edición administrativa genérica no acepta `isActive`; esto evita omitir el
flujo transaccional de baja y su auditoría.

## Datos preservados

La baja no ejecuta eliminaciones sobre:

- `users` ni `user_schools`;
- rectificaciones y snapshots institucionales;
- campañas asignadas;
- presentaciones, respuestas y resultados de evaluación;
- registros de auditoría y reportes históricos.

No requiere una migración: `schools.is_active` y
`auth_sessions.revoked_at` ya forman parte del modelo.
