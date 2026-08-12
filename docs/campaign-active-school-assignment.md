# Incorporación de escuelas durante una etapa activa

La respuesta funcional final habilita al administrador central a incorporar
una escuela nueva cuando una etapa ya está activa. A partir de la asignación,
la escuela aparece en su listado de etapas y puede comenzar el diagnóstico
si además conserva una cuenta asociada y completó la rectificación
institucional requerida.

## Reglas

- `POST /api/admin/campaigns/:id/schools/preview` y
  `POST /api/admin/campaigns/:id/schools/assign` aceptan etapas `draft` y
  `active`.
- En `active`, sólo se pueden incorporar o reactivar escuelas activas. Una
  asignación que ya estaba vigente continúa siendo idempotente aunque la
  escuela haya sido dada de baja posteriormente.
- Una etapa `active` cuya fecha de fin ya venció no acepta incorporaciones,
  aunque el cierre periódico todavía no haya actualizado su estado.
- Las etapas `closed` y `archived` no aceptan incorporaciones.
- `DELETE /api/admin/campaigns/:id/schools/:schoolId` continúa habilitado sólo
  en `draft`. El alta durante una etapa activa no permite retirar escuelas de
  su universo histórico.
- Repetir una asignación vigente no crea otra fila. Una asignación previamente
  removida puede reactivarse, conservando el mismo par único etapa/escuela.
- La asignación no activa una escuela dada de baja ni reemplaza la asociación
  entre escuela y usuario. Las protecciones de login y nuevas cargas siguen
  vigentes.

## Trazabilidad y concurrencia

Cada asignación conserva `assigned_at`, `assigned_by_user_id` y
`assignment_source`. El evento `CAMPAIGN_SCHOOLS_ASSIGNED` registra además el
estado de la etapa, cantidades, identificadores efectivamente asignados y
los identificadores reactivados.

La operación bloquea la fila de la etapa dentro de la misma transacción que
persiste las asignaciones. Los cambios de estado utilizan el mismo bloqueo. En
una etapa activa también bloquea las escuelas nuevas para serializar el alta
con una posible baja administrativa. De este modo, cada operación observa un
estado consistente y no puede confirmarse detrás de un cierre o una baja que
obtuvo primero el bloqueo.

No se requiere migración: `campaign_schools` ya posee la restricción única, la
baja lógica y las columnas de actor, fecha y fuente necesarias.
