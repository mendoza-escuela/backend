# Persistencia de resultados de evaluación

## Alcance

El módulo `evaluation` conserva el resultado actual de cada presentación
enviada. El cálculo se ejecuta en backend con el algoritmo
`question-average-dynamic-denominator-v1`.

No incluye historial de revisiones, recálculo masivo, dashboard,
exportaciones ni modificación manual de puntajes.

## Modelo híbrido

Se utiliza una combinación de datos normalizados y un snapshot JSONB:

- `evaluation_results`: puntaje general, identificadores de presentación,
  etapa, escuela y versión, versión del algoritmo, fecha y responsable del
  cálculo.
- `evaluation_dimension_results`: seis filas consultables por resultado con
  numerador, denominador, puntaje y criticidad por dimensión.
- `evaluation_results.snapshot`: copia autocontenida de todos los datos usados
  para reconstruir y auditar el cálculo.

Los campos normalizados permiten consultas agregadas e índices eficientes para
futuros dashboards y exportaciones. El snapshot evita depender de cambios
posteriores en la ficha escolar, el cuestionario o sus reglas.

La restricción única sobre `submission_id` representa el resultado vigente. Si
en el futuro se incorpora historial, esta tabla puede mantenerse como
proyección actual y agregarse una tabla de revisiones sin cambiar la estructura
del snapshot.

## Contenido del snapshot

```text
schemaVersion
algorithm
  version
  calculatedAt
result
  generalScore
  numerator
  denominator
  stars
    value: null
    ruleVersion: null
    blockingReasons: []
submission
  id, campaignId, schoolId, surveyVersionId
  schoolRectificationId, submittedAt
  originalRespondent
school
  snapshot completo de la rectificación utilizada
survey
  identidad del cuestionario
  versión, instrucciones y fecha de publicación
  dimensions[]
    resultado de la dimensión
    criticidad, valor, umbral y versión de la regla
    sections[]
      questions[]
        tipo, texto, orden y validaciones
        options[] con puntaje
        rules[] y conditions[]
        applicability y motivo
        answer y opción seleccionada
        scoreUsed
```

## Escritura y recálculo

`EvaluationResultsService.calculateAndPersist` debe ejecutarse dentro de una
transacción. El servicio:

1. Bloquea la presentación con `pessimistic_write`.
2. Valida versión, estructura, respuestas, opciones y aplicabilidad.
3. Calcula el puntaje general y las seis dimensiones.
4. Crea o actualiza la única fila de resultado.
5. Elimina y reemplaza las seis filas de dimensiones.
6. Reemplaza por completo el snapshot.
7. Registra la operación en `audit_logs`.

Un error revierte la transacción completa. Las respuestas originales nunca son
actualizadas por este servicio.

`recalculateSubmission` permite recalcular una sola presentación enviada usando
sus respuestas, decisiones de aplicabilidad y ficha histórica. No está expuesto
como endpoint y no implementa recálculo masivo.

## Salud Mental crítica y estrellas

La dimensión `salud_mental` se marca como crítica únicamente cuando su puntaje
es estrictamente menor que `33`. Se persisten el valor, el umbral y la versión
`mental-health-critical-lt-33-v1`. Un valor igual a `33` no es crítico.

Las columnas `stars`, `star_rule_version` y `star_blocking_reasons` preparan la
persistencia futura de estrellas. El flujo actual conserva estrellas y versión
en `null`, sin redondear ni asignar valores provisorios.

## Consulta de la escuela

```http
GET /api/school/campaigns/:campaignId/submission/result
GET /api/school/results
```

Requiere JWT, contraseña inicial ya cambiada y rol `school`. La escuela se
resuelve desde la sesión autenticada; el cliente no envía un `schoolId`.

El primer endpoint devuelve el contrato público de “Resultado preliminar”
construido desde el snapshot persistido. Distingue mediante códigos estables
una presentación inexistente (`SUBMISSION_NOT_FOUND`), un borrador
(`SUBMISSION_DRAFT`), un envío sin cálculo
(`PRELIMINARY_RESULT_NOT_GENERATED`) y datos históricos incompletos
(`HISTORICAL_RESULT_INCOMPLETE`).

El segundo endpoint lista los resultados históricos de la escuela para
permitir su navegación aunque la etapa ya no esté activa. Ninguno de los dos
endpoints recalcula puntajes ni consulta la ficha, preguntas, opciones o reglas
actuales. El nombre de etapa se obtiene de la etapa asociada, cuyos datos
funcionales quedan protegidos después de activarse.

## Migración

La migración `1720375215000-AddEvaluationResults.ts` crea ambas tablas, claves
foráneas, controles de rango, la restricción única por presentación e índices
para presentación, etapa, escuela, versión y dimensiones.

La migración `1720375216000-AddCriticalityAndFutureStars.ts` agrega la
criticidad normalizada, su índice y los campos reservados para estrellas. Los
resultados existentes de Salud Mental se completan usando el umbral confirmado.

Los puntajes usan `numeric(11,8)` y los numeradores `numeric(16,8)`.
