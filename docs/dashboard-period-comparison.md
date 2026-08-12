# DASH-08 — Comparación entre períodos

El dashboard administrativo compara entre dos y seis etapas mediante:

```http
GET /api/admin/dashboard/results/comparison?campaignIds=<uuid-1>&campaignIds=<uuid-2>
```

`campaignIds` es obligatorio, conserva el orden solicitado y no admite valores
duplicados. El primer ID es la línea de base. Las etapas en borrador se
rechazan porque todavía no poseen resultados publicables.

El endpoint acepta los filtros institucionales y escolares de DASH-04, excepto
`campaignId`. No acepta `submissionStatuses`, `stars` ni `criticalAreas`: esos
filtros seleccionan por el resultado de cada período y producirían una
comparación sesgada. Los valores permitidos se aplican de forma independiente a
cada etapa: no se crea implícitamente una cohorte común ni se modifica el
universo histórico de cada período.

## Métricas comparables

La respuesta incluye por período:

- universo, resultados y cobertura con sus denominadores propios;
- promedio general de 0 a 100;
- distribución de certificaciones de 1 a 5 estrellas.

No se promedian estrellas porque son una certificación ordinal. De acuerdo con
la respuesta funcional final, el puntaje general y la certificación de estrellas
son las únicas métricas históricas estandarizadas cuando cambian preguntas,
dimensiones, pesos o reglas.

La distribución compara la certificación oficial vigente que quedó persistida
en cada resultado; no recalcula ni homogeneiza configuraciones entre períodos.
En una comparación agregada la configuración exacta no se presenta como si
fuera única. Su metadata se expone únicamente al consultar una escuela.

La respuesta explicita esta semántica en `comparisonPolicy`:

```json
{
  "standardizedMetrics": ["generalScore", "stars"],
  "dimensionSeries": "visual_trajectory",
  "cohortMode": "independent_campaign_universes",
  "schoolProfileSource": "current",
  "filterScope": "institutional_only",
  "excludedOutcomeFilters": ["submissionStatuses", "stars", "criticalAreas"]
}
```

Los filtros institucionales usan la ficha escolar vigente, igual que DASH-04.
El cliente todavía debe definir si una vista histórica futura debe reconstruir
la ficha al cierre de cada etapa.

## Trayectoria dimensional de una escuela

El radar comparativo sólo se entrega cuando el filtro identifica exactamente
una escuela (`schoolIds` o la clave singular compatible `schoolId`). El radar
territorial permanece fuera de este contrato porque la respuesta funcional lo
deja expresamente pendiente de definición.

Las dimensiones se leen de `evaluation_dimension_results`, donde quedaron
persistidos el código, título, orden y puntaje del resultado. No se reconstruyen
desde la plantilla oficial vigente.

`radarComparison` informa si la superposición puede interpretarse como una
comparación homogénea:

| `mode`        | `reason`                       | Significado                                                                                      |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `comparable`  | `null`                         | Todos los períodos tienen resultado y coinciden versión de cuestionario y algoritmo dimensional. |
| `descriptive` | `different_survey_version`     | Cambió el instrumento.                                                                           |
| `descriptive` | `different_algorithm_version`  | Cambió el algoritmo dimensional.                                                                 |
| `descriptive` | `unknown_calculation_metadata` | Un resultado histórico no permite comprobar el algoritmo usado.                                  |
| `unavailable` | `missing_result`               | La escuela no posee resultado en todos los períodos.                                             |
| `unavailable` | `single_school_required`       | No se seleccionó exactamente una escuela.                                                        |

Una serie descriptiva puede mostrarse con advertencia, pero no debe presentarse
como medición estandarizada. `commonDimensions` contiene sólo códigos con valor
en todos los períodos elegidos. Cada período también informa
`algorithmVersion`, `evaluationConfigurationVersion`, `calculationSource` y
`calculatedAt`. La configuración se conserva para interpretar estrellas y
alertas, pero no condiciona la geometría porque no modifica los puntajes
dimensionales. Se consulta el resultado vigente persistido, incluida una
eventual corrección o recalculación; no se reconstruyen revisiones dimensionales
anteriores.

Las consultas de etapas, métricas generales y dimensiones se ejecutan dentro
de una transacción `REPEATABLE READ` de sólo lectura. Así, una recalculación
concurrente no puede mezclar el resumen anterior con dimensiones nuevas.

## Forma resumida de la respuesta

```json
{
  "baselineCampaignId": "uuid-1",
  "comparisonPolicy": {},
  "radarComparison": {
    "available": true,
    "comparable": true,
    "mode": "comparable",
    "reason": null,
    "selectedSchoolId": "school-uuid"
  },
  "commonDimensions": [
    { "code": "salud_mental", "title": "Salud mental", "order": 5 }
  ],
  "periods": [
    {
      "campaign": {
        "id": "uuid-1",
        "type": "annual",
        "surveyVersionId": "survey-version-uuid",
        "isPartial": false
      },
      "denominators": {},
      "metrics": {
        "generalAverage": 72.5,
        "dimensionAverages": []
      },
      "starDistribution": [],
      "calculationMetadata": {
        "algorithmVersion": "algorithm-v1",
        "evaluationConfigurationVersion": "rules-v1",
        "calculationSource": "submission_finalization",
        "calculatedAt": "2026-08-11T12:00:00.000Z"
      }
    }
  ]
}
```

No se requiere una migración de base de datos para DASH-08.
