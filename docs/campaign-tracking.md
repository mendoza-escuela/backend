# Seguimiento administrativo de presentaciones

## Universo de escuelas

El modelo actual utiliza campañas de padrón abierto y no posee una asignación
cerrada campaña–escuela. El seguimiento incluye:

- escuelas registradas hasta la fecha de cierre de la campaña;
- escuelas activas e inactivas;
- toda escuela que ya posea una presentación para la campaña, aun ante una
  inconsistencia histórica de fechas.

Para un cierre manual anticipado se usa `closed_at` cuando es anterior a
`ends_at`. De este modo, escuelas creadas después del cierre no se incorporan
retroactivamente a campañas históricas.

Una futura selección explícita de establecimientos requerirá una entidad de
asignación y una definición funcional adicional.

## Estados

Los tres estados son excluyentes:

- `not_started`: escuela sin presentación.
- `draft`: presentación con estado técnico `draft`.
- `submitted`: presentación con estado técnico `submitted`.

No existen en este módulo estados de revisión, observación, validación,
devolución ni certificación.

## Porcentajes

El avance general se calcula como:

```text
presentaciones enviadas / escuelas incluidas × 100
```

El porcentaje de cada estado usa su cantidad sobre el mismo total. Cuando el
total es cero, todos los porcentajes son cero.

No se asigna una ponderación parcial a los borradores. En cada fila se muestra
un indicador operativo:

- no iniciada: 0%;
- borrador: respuestas guardadas / preguntas aplicables persistidas;
- enviada: 100% del flujo de presentación.

Este indicador individual no interviene en el avance general.

## Endpoints

```http
GET /api/admin/campaigns/tracking/options
GET /api/admin/campaigns/:id/tracking/summary
GET /api/admin/campaigns/:id/tracking
```

El listado admite `search`, `status`, `sortBy`, `sortDirection`, `page` y
`limit`. La búsqueda, filtros, orden y paginación se ejecutan en PostgreSQL.

Todos los endpoints requieren JWT, contraseña inicial cambiada y rol `admin`.

## Historial

El usuario se representa con `original_respondent_snapshot`, conservado en la
presentación. Su estado activo se obtiene del registro actual cuando todavía
existe. Una escuela o un usuario inactivo permanece visible.

Si el snapshot histórico está incompleto, la fila no se elimina: se devuelve
`historicalDataComplete: false` para que la interfaz lo indique.

## Índices

La migración `1720375217000-AddCampaignTrackingIndexes.ts` agrega índices para:

- campaña y último guardado;
- campaña y fecha de envío;
- fecha de incorporación de la escuela.

Se reutilizan además los índices existentes de campaña/estado, unicidad
escuela/campaña y búsqueda por CUE o nombre.
