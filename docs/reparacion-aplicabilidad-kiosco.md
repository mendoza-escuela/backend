# Reparación auditada de aplicabilidad de kiosco

## Definición funcional confirmada

El 11/08/2026 se confirmó que las preguntas dependientes de kiosco son
exactamente `p021`, `p022`, `p023`, `p024`, `p025`, `p026` y `p027`. También se
autorizó recalcular las presentaciones enviadas afectadas por este defecto.

La autorización funcional no reemplaza los controles operativos: antes de
escribir en un ambiente compartido siguen siendo obligatorios el backup
verificado, la vista previa del conjunto exacto y la ejecución inicial en QA.

## Alcance

Este procedimiento corrige exclusivamente presentaciones enviadas cuyo snapshot histórico declara `hasKiosk=false` y que conservan alguna decisión distinta de `excluded` para `p021` a `p027`.

No modifica la ficha escolar actual, respuestas, versiones publicadas ni snapshots de otras campañas. El resultado se recalcula desde los datos históricos de la presentación dentro de la misma transacción.

## Comportamiento de versiones nuevas

Los códigos `p021-p027` pertenecen únicamente al alcance histórico de esta
reparación. El sistema no exige reglas para códigos concretos, no crea reglas
automáticamente al importar y no bloquea campañas por la ausencia de esas
reglas. Administración define desde el editor qué preguntas son condicionales.

Backend continúa validando la estructura de cada regla que el usuario decida
crear y evalúa esas reglas contra el snapshot de la ficha escolar. Las
versiones publicadas continúan siendo inmutables.

## Aplicación futura de la regla histórica

No se debe insertar reglas directamente en una versión publicada ni desactivar
sus triggers de protección. Si administración decide conservar esta regla en
una campaña futura:

1. crear o importar una nueva versión oficial que persista la regla aprobada en
   `p021-p027`;
2. validar la versión y las reglas configuradas;
3. publicar la nueva versión;
4. cerrar la campaña defectuosa y crear una campaña con la versión corregida;
5. validar escuelas con y sin kiosco antes de habilitar el uso general.

Una campaña conserva su `surveyVersionId`; no se cambia ese vínculo después de
haber iniciado presentaciones. Los borradores de la campaña anterior tampoco
se migran automáticamente, porque hacerlo mezclaría dos definiciones del
cuestionario bajo el mismo histórico. Cerrar y reemplazar una campaña activa es
una acción operativa que requiere aprobación específica del responsable.

## Requisitos previos

1. Aplicar todas las migraciones, incluida `AllowAuditedApplicabilityDataRepair1720375220000`.
2. Contar con un backup verificado del ambiente objetivo conforme a la política institucional.
3. Usar una cuenta administradora autorizada y registrar la aprobación del responsable funcional.
4. Ejecutar primero en QA y conservar la respuesta de la auditoría previa.

## Auditoría sin escritura

```http
GET /api/admin/evaluation/data-quality/kiosk-applicability
GET /api/admin/evaluation/data-quality/kiosk-applicability?campaignId=<uuid>
```

La respuesta incluye cantidades, cada presentación afectada, preguntas, resultado anterior y una `fingerprint` SHA-256. La consulta no abre una transacción de escritura ni modifica datos.

La huella de este `GET` representa todo el conjunto encontrado. Para reparar un
subconjunto debe generarse una vista previa específica; no debe reutilizarse la
huella global:

```http
POST /api/admin/evaluation/data-quality/kiosk-applicability/preview
Content-Type: application/json

{
  "submissionIds": ["<uuid>"]
}
```

La selección admite entre 1 y 500 UUIDs únicos. Si alguno ya no requiere la
corrección, responde `409 DATA_REPAIR_SELECTION_NOT_ELIGIBLE`. La respuesta
mantiene el formato de auditoría, agrega `repairable` y detalla por presentación
los `recalculationBlockers`. La `fingerprint` devuelta es la que debe enviarse al
endpoint de reparación.

## Confirmación y reparación

Después de revisar el conjunto exacto, enviar como máximo 500 presentaciones:

```http
POST /api/admin/evaluation/data-quality/kiosk-applicability/repair
Content-Type: application/json

{
  "targets": [
    { "submissionId": "<uuid>" }
  ],
  "previewFingerprint": "<fingerprint de la auditoría>",
  "confirm": true
}
```

El servicio vuelve a auditar bajo bloqueo. Si la selección o la huella cambiaron, responde `409 DATA_REPAIR_PREVIEW_STALE` y no escribe nada. `confirm=false` responde `400 DATA_REPAIR_CONFIRMATION_REQUIRED`.

Cada reparación:

- cambia sólo las decisiones afectadas a `excluded` con motivo `DATA_CORRECTION_KIOSK_NOT_APPLICABLE`;
- recalcula numerador, denominador, promedio, dimensiones, estrellas y alertas;
- conserva el antes/después en `audit_logs` bajo `KIOSK_APPLICABILITY_DATA_REPAIRED`;
- confirma todos los cambios de la selección o revierte toda la transacción.

## Garantías del recálculo histórico

Una reparación no usa la configuración activa del momento. Reutiliza por ID la
misma configuración persistida en el resultado original. Además, sólo recalcula
si la versión almacenada del algoritmo coincide con la versión disponible en el
código desplegado.

El lote se bloquea sin modificar datos cuando aparece alguno de estos códigos:

- `EVALUATION_RECALCULATION_RESULT_REQUIRED`: no existe un resultado previo;
- `EVALUATION_RECALCULATION_CONFIGURATION_REQUIRED`: el resultado no referencia una configuración histórica disponible;
- `EVALUATION_RECALCULATION_ALGORITHM_DRIFT`: el algoritmo original es distinto del actual;
- `EVALUATION_RECALCULATION_CONFIGURATION_DRIFT`: la versión resuelta por ID no coincide con la registrada en el resultado.

Estos casos requieren una migración de datos específica y no deben forzarse con
este reparador.

Las respuestas que habían sido guardadas para `p021-p027` se conservan como
evidencia histórica, pero quedan excluidas del numerador, denominador,
dimensiones, estrellas y alertas. No deben presentarse como respuestas
aplicables en reportes posteriores.

La excepción de inmutabilidad usa una variable local de PostgreSQL habilitada únicamente dentro de esa transacción. Fuera del procedimiento, las decisiones de una presentación enviada continúan protegidas por el trigger.

## Verificación posterior

1. Repetir el `GET`: las presentaciones corregidas ya no deben aparecer.
2. Revisar el detalle administrativo, CSV, XLSX y PDF de una muestra representativa.
3. Comparar numerador y denominador con la auditoría previa.
4. Confirmar los eventos de auditoría y adjuntar la evidencia a la validación de QA.

No existe una reversión automática posterior al commit porque restaurar una decisión defectuosa dañaría el histórico. Cualquier corrección posterior debe diseñarse como una nueva operación auditada y aprobada.
