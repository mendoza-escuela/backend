# Seguimiento administrativo de presentaciones

## Universo de escuelas

El universo se define explícitamente mediante `campaign_schools`. El
seguimiento incluye sólo asignaciones vigentes (`removed_at IS NULL`) de la
campaña seleccionada, incluso si la escuela fue desactivada posteriormente.

Mientras la campaña está en borrador se pueden incorporar, reactivar y quitar
escuelas. No se permite quitar una escuela que ya tenga una presentación. Al
activar se exige una versión publicada y al menos una escuela asignada.

Durante una campaña activa el universo admite únicamente incorporaciones: una
escuela habilitada puede agregarse de forma manual, masiva o por filtros y queda
disponible inmediatamente dentro del período de carga. No se permiten bajas en
este estado, de modo que una incorporación no puede retirar ni alterar el
histórico de otra escuela. Las campañas cerradas o archivadas son de sólo
lectura; también se rechaza el alta si la fecha de cierre ya venció aunque el
proceso periódico todavía no haya persistido el estado `closed`.

Cada alta conserva en `campaign_schools` la fecha, el origen y el administrador
responsable. La misma transacción registra en auditoría el estado de la campaña,
las escuelas efectivamente incorporadas y las asignaciones reactivadas. La
restricción única por campaña y escuela hace que una solicitud repetida sea
idempotente. Si la escuela es desactivada después, su asignación y su historial
permanecen en el universo, aunque el acceso y las nuevas cargas queden
bloqueados.

La migración `AddCampaignSchoolsAndSchoolContacts1720375219000` conserva las
campañas existentes: crea asignaciones para el universo histórico anterior y
para cualquier escuela con una presentación ya registrada.

La fecha `inclusionCutoff` del resumen se mantiene como metadato histórico de
cierre; ya no determina qué escuelas integran el denominador.

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
`limit` (máximo 100). La búsqueda, filtros, orden y paginación se ejecutan en
PostgreSQL. El total usa una consulta separada; después se obtiene sólo la
página de IDs con `LIMIT/OFFSET` y los detalles, respuestas y aplicabilidad se
calculan exclusivamente para esos IDs. El orden estable usa nombre, CUE e ID.

Todos los endpoints requieren JWT, contraseña inicial cambiada y rol `admin`.

## Historial

El usuario se representa con `original_respondent_snapshot`, conservado en la
presentación. Su estado activo se obtiene del registro actual cuando todavía
existe. Una escuela o un usuario inactivo permanece visible.

Si el snapshot histórico está incompleto, la fila no se elimina: se devuelve
`historicalDataComplete: false` para que la interfaz lo indique.

## Índices

Las migraciones de seguimiento y asignación agregan índices para:

- campaña y último guardado;
- campaña y fecha de envío;
- campaña y estado de presentación;
- campaña y asignación vigente;
- escuela y asignación vigente;
- campaña, fecha de asignación y escuela para asignaciones no removidas.

Se reutilizan además los índices existentes de campaña/estado, unicidad
escuela/campaña y búsqueda por CUE o nombre.

## Verificación con 2.500 escuelas

La prueba versionada
`test/campaign-tracking.pagination.e2e-spec.ts` carga 2.500 escuelas en
PostgreSQL, distribuidas entre los tres estados, y verifica:

- 20 elementos como máximo con `limit=20`;
- páginas consecutivas sin repetición ni solapamiento;
- orden ascendente y descendente estable;
- búsqueda exacta por CUE;
- cantidad y contenido de `not_started`, `draft` y `submitted`;
- payload menor a 100 KB por página;
- tiempo menor a 5 segundos por llamada para tolerar variaciones de CI.

Medición local de referencia del 10 de agosto de 2026 sobre PostgreSQL 17.10
en Docker, con la API y la base en el mismo equipo:

| Escenario | Tiempo | Payload |
| --- | ---: | ---: |
| Página 1, 20 filas | 31,45 ms | 5.616 bytes |
| Página 2, 20 filas | 18,79 ms | 5.616 bytes |
| Orden descendente, 20 filas | 19,36 ms | 11.196 bytes |
| Búsqueda por CUE, 1 fila | 13,32 ms | 599 bytes |
| Estado no iniciada, 20 filas | 24,70 ms | 5.614 bytes |
| Estado borrador, 20 filas | 22,38 ms | 10.634 bytes |
| Estado enviada, 20 filas | 21,96 ms | 11.194 bytes |

Son valores diagnósticos, no un SLA. Para repetir la prueba contra una base
vacía con todas las migraciones aplicadas:

```bash
TEST_DATABASE_URL=postgresql://usuario:clave@localhost:5432/base_prueba \
  npm run test:tracking:integration
```
