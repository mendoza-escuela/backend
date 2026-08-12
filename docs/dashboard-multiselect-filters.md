# DASH-04 — Filtros multiselección

Los endpoints de participación, resultados, alertas críticas y exportaciones
aceptan filtros multiselección. La serialización canónica repite la clave:

```http
GET /api/admin/dashboard/results?campaignId=<uuid>&departments=Capital&departments=Lavalle&submissionStatuses=draft&submissionStatuses=submitted
```

También se acepta un valor único para mantener compatibilidad. No se usa CSV:
las claves repetidas evitan ambigüedad y preservan correctamente textos que
contienen comas.

## Semántica

- Los valores de una misma categoría se combinan con **OR** (`IN`).
- Las categorías diferentes se combinan con **AND**.
- `campaignId` continúa siendo único.
- `dimensionCode` continúa siendo el refinamiento único del panel de alertas.
- Cada colección territorial/escolar admite hasta 100 valores. Estados,
  estrellas y áreas críticas se limitan a sus catálogos cerrados.

| Query plural         | Valores                                         |
| -------------------- | ----------------------------------------------- |
| `schoolIds`          | UUID de escuela                                 |
| `departments`        | Departamento                                    |
| `localities`         | Localidad                                       |
| `educationLevels`    | Código estable de `education_level_catalogs`    |
| `educationTypes`     | Tipo de educación de la ficha escolar           |
| `managementTypes`    | Sector/gestión                                  |
| `scopes`             | Ámbito                                          |
| `shifts`             | Jornada                                         |
| `submissionStatuses` | `not_started`, `draft`, `submitted`             |
| `stars`              | Enteros del 1 al 5                              |
| `criticalAreas`      | Código de una de las seis dimensiones oficiales |

`not_started` significa que la asignación no posee presentación. Las
combinaciones con `draft` o `submitted` se resuelven con un OR agrupado, sin
alterar el AND con las otras categorías.

En el resumen de alertas, `criticalAreas` acota las escuelas y dimensiones
mostradas, pero el porcentaje conserva como denominador todos los resultados
que cumplen los demás filtros. Así, seleccionar un área no convierte
artificialmente el indicador en 100 %.

El filtro **Nivel** usa `school_education_levels` y el código del catálogo
oficial mediante `EXISTS`; no realiza un join externo que multiplique escuelas
en las métricas. `schools.education_level` representa **Tipo de educación** y
se expone por separado como `educationTypes`.

Las exportaciones de resultados rotulan ese dato como `Tipo de educación` e
incluyen además `Niveles educativos` con etiqueta y código de cada nivel
estructurado. La agregación se realiza mediante una subconsulta correlacionada
y no duplica filas del establecimiento.

## Opciones dependientes

`GET /api/admin/dashboard/participation/filters` acepta `departments` y
`localities` multivalor. Las localidades representan la unión de los
departamentos seleccionados y las escuelas respetan ambos filtros.

La respuesta incluye:

- `educationLevelOptions: Array<{ value, label }>` con código y etiqueta
  oficiales;
- `educationTypes: string[]`;
- `criticalAreas: Array<{ value, label }>` con las seis dimensiones;
- el resto de catálogos históricos como listas de texto.

## Compatibilidad

Por compatibilidad con despliegues desacoplados, la respuesta conserva
temporalmente `educationLevels: string[]` con el contenido histórico de Tipo de
educación. Las interfaces nuevas deben utilizar `educationLevelOptions` para el
Nivel real y `educationTypes` para Tipo de educación.

También se conservan temporalmente las claves singulares `schoolId`, `department`,
`locality`, `educationLevel`, `managementType`, `scope` y `shift`. En ese
contrato anterior, `educationLevel` filtra el campo legado que actualmente se
denomina Tipo de educación. Las exportaciones también conservan `status` y
`criticalArea`. Los valores nuevos y legados se combinan sin duplicados.

No se requiere migración de base de datos para este cambio.

## Corte temporal de la ficha

Los filtros territoriales e institucionales conservan el comportamiento
existente y consultan la ficha escolar vigente. Esto permite incluir también
escuelas no iniciadas, para las que no existe snapshot de envío. Si se requiere
que una campaña histórica se reclasifique según la ficha que tenía la escuela
en ese período, el cliente debe definir la fecha de corte y la fuente histórica;
esa reconstrucción no forma parte de DASH-04 y no se infiere silenciosamente.
