# Reparación auditada de aplicabilidad de kiosco

## Alcance

Este procedimiento corrige exclusivamente presentaciones enviadas cuyo snapshot histórico declara `hasKiosk=false` y que conservan alguna decisión distinta de `excluded` para `p021` a `p027`.

No modifica la ficha escolar actual, respuestas, versiones publicadas ni snapshots de otras campañas. El resultado se recalcula desde los datos históricos de la presentación dentro de la misma transacción.

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

La excepción de inmutabilidad usa una variable local de PostgreSQL habilitada únicamente dentro de esa transacción. Fuera del procedimiento, las decisiones de una presentación enviada continúan protegidas por el trigger.

## Verificación posterior

1. Repetir el `GET`: las presentaciones corregidas ya no deben aparecer.
2. Revisar el detalle administrativo, CSV, XLSX y PDF de una muestra representativa.
3. Comparar numerador y denominador con la auditoría previa.
4. Confirmar los eventos de auditoría y adjuntar la evidencia a la validación de QA.

No existe una reversión automática posterior al commit porque restaurar una decisión defectuosa dañaría el histórico. Cualquier corrección posterior debe diseñarse como una nueva operación auditada y aprobada.
