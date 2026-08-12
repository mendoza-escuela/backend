# Detalle administrativo por escuela y etapa

## Endpoint

`GET /api/admin/campaigns/:campaignId/schools/:schoolId/result-detail`

Requiere JWT, contraseña inicial ya modificada y rol `admin`. Los dos parámetros son UUID. El endpoint no recibe datos de cálculo ni ejecuta nuevamente el motor de evaluación.

El modelo vigente sólo define los roles `admin` y `school`; no existe un rol administrativo territorial con alcance parcial. Por eso el guard central de administrador es el alcance aplicable y el rol escuela queda rechazado. Si se incorporan alcances territoriales en el futuro, deberán agregarse a la misma policy antes de habilitar otros roles.

## Fuente de verdad histórica

Cuando existe un resultado, puntajes, estrellas, dimensiones, alertas, respuestas, exclusiones, reglas, ficha escolar, versión del cuestionario y versión del algoritmo se leen de `evaluation_results.snapshot`. La ficha actual de `schools` se usa sólo para identificar la escuela y mostrar su estado administrativo actual.

Para un borrador se informa únicamente su ciclo de vida y el usuario original. No se presentan sus respuestas como si hubieran sido enviadas. Para envíos antiguos sin resultado o sin snapshot se devuelven estados y banderas de calidad explícitas; no se completan datos con valores actuales.

## Estados contemplados

- `not_started`: escuela incluida sin presentación.
- `draft`: presentación iniciada pero no enviada.
- `submitted` con `result: null`: envío persistido aún sin resultado.
- `submitted` con resultado: detalle histórico completo o parcial según las banderas de calidad.

El usuario original procede primero de `original_respondent_snapshot`; su estado activo/inactivo actual se consulta por identificador cuando todavía existe.

## Rendimiento y base de datos

La consulta realiza una cantidad fija de accesos (etapa/escuela, presentación, resultado y usuario), independiente de la cantidad de preguntas, ya que éstas están dentro del snapshot JSONB. No se agregó migración: ya existen la restricción única `(school_id, campaign_id)` en presentaciones y los índices de resultados por etapa, escuela y presentación.

No se registra auditoría de lectura: el patrón actual audita cambios administrativos y esta pantalla no ofrece ninguna acción modificatoria.

## Frontend

Ruta recargable: `/admin/campanas/:campaignId/colegios/:schoolId/resultado`.

Se accede desde Seguimiento mediante “Ver detalle”. El dashboard enlaza directamente cuando hay una escuela filtrada o lleva al seguimiento de la etapa. El parámetro `volver` conserva la URL de origen y se acepta únicamente si pertenece a `/admin/`.

La página separa Resumen, Respuestas, Exclusiones, Ficha histórica e Historial. Incluye estados vacíos para no iniciada, borrador, enviada sin resultado, snapshot incompleto y ausencia de exclusiones. Las pruebas añadidas cubren autorización, parámetros inválidos, pertenencia al universo, estados sin presentación/borrador y renderizado de datos históricos.
