# SUR-02 — Cuestionario institucional de 60 preguntas

## Fuente y precedencia

La planilla consolidada se genera desde:

1. `Arquitectura de datos para la App de Escuelas Promotoras de Salud Mendoza. DEFINITIVA`, que contiene el banco original de 60 preguntas.
2. `Respuestas Funcionales Final`, que prevalece ante cualquier contradicción con la fuente anterior.

El artefacto de revisión y futura importación es `docs/plantilla-cuestionario-completo.xlsx` y se regenera con:

```bash
npm run survey:generate-official-template
```

La generación valida la planilla con el mismo importador que usa la API. La estructura fuente debe conservar seis dimensiones, siete secciones, sesenta preguntas y 179 opciones puntuables. La vista previa debe aceptar las 179 filas con sus puntajes completos; cualquier error detiene la generación.

## Decisiones incorporadas

- Exactamente 60 preguntas de selección simple, con códigos estables `p001` a `p060`.
- Seis dimensiones oficiales. Las preguntas 41, 42 y 43 pertenecen a `salud_mental`.
- Todas las preguntas aplicables son obligatorias.
- No se incluyen respuestas genéricas “Otro” ni “No aplica”.
- p010 usa 10 minutos para desayuno/merienda y 30 minutos para almuerzo tanto en el enunciado como en la opción óptima.
- p020 conserva en la hoja `Fuente` la nueva alternativa “El establecimiento no cuenta con Comedor”. No se presenta como respuesta puntuable mientras no se defina su tratamiento de exclusión.
- La condición de kiosco quedó cerrada: exactamente `p021-p027` dependen de `hasKiosk`; con kiosco aplican, sin kiosco se excluyen y sin el dato la evaluación queda incompleta.
- p032 usa el texto y las frecuencias de consumo definidos en la respuesta funcional final.
- p046 usa “No se abordan estos temas.” como tercera opción y ya no contiene alternativas duplicadas.
- La escala general confirmada es `100/50/0` y la escala de Salud Mental es `100/66/33/0`.
- Los puntajes se obtienen de la misma política central que usa la validación de publicación; el generador no conserva una copia independiente de las escalas o la matriz.

El generador y la planilla binaria versionada ya no incluyen kiosco ni
definiciones de puntuación en la hoja `Pendientes`. Allí permanecen únicamente
los bloqueantes de contenido y aplicabilidad que aún requieren definición.

La hoja `Fuente` conserva 197 alternativas para trazabilidad. La hoja `Cuestionario` excluye las respuestas de infraestructura que deben resolverse mediante aplicabilidad y contiene 179 opciones puntuadas e importables.

## Inventario de puntuación

La hoja `Mapeo de puntajes` contiene una fila por pregunta y muestra el perfil de referencia, la secuencia aplicada según el orden actual de las opciones, el estado y su trazabilidad. La matriz vigente es:

| Preguntas                                         | Tipo                                                                | Mapeo según orden de opciones | Estado     |
| ------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------- | ---------- |
| p001–p021, p024, p026–p037, p039–p040 y p044–p046 | General, tres opciones                                              | `100/50/0`                    | Confirmado |
| p022, p023 y p025                                 | General, dos opciones                                               | `100/0`                       | Confirmado |
| p038                                              | Excepción aprobada, cuatro opciones                                 | `100/66/33/0`                 | Confirmado |
| p052                                              | Salud Mental, cuatro opciones ordenadas de menor a mayor desarrollo | `0/33/66/100`                 | Confirmado |
| p041–p043, p047–p051 y p053–p060                  | Salud Mental, tres opciones                                         | `100/50/0`                    | Confirmado |

La matriz de puntuación está completa y no contiene valores provisionales.

## Definiciones necesarias antes de publicar

La puntuación ya no bloquea la importación. Continúan pendientes estas decisiones:

1. **Comedor/jornada:** enumerar exactamente qué preguntas se excluyen y la expresión aplicable.
2. **p041:** confirmar si “Se trabaja de forma limpia, transversal y sostenida” es el texto intencional.
3. **p051:** confirmar la primera alternativa, actualmente referida a adultos designados y horas programáticas aunque la pregunta trata sobre participación familiar.
4. **p059:** confirmar la redacción “Incluido de forma con implementación específica activa y sostenida”.

Hasta recibir estas definiciones se conservan los textos de la fuente y no se inventan reglas de exclusión.

Cuando una versión conserva al menos un código oficial de dimensión o de pregunta (`p001`–`p060`), `POST /api/admin/surveys/:surveyId/versions/:versionId/publish` valida la matriz completa aprobada. Una secuencia diferente devuelve `400`. Esos identificadores forman el espacio de nombres reservado del instrumento institucional; los cuestionarios personalizados deben usar códigos propios. El endpoint de validación previa aplica la misma política.

## Regresión automatizada

`official-survey-workbook.spec.ts` verifica:

- los 60 códigos consecutivos y las seis dimensiones;
- obligatoriedad de todas las preguntas aplicables;
- correcciones exactas de p010, p032 y p046;
- trazabilidad de la alternativa agregada a p020;
- ausencia de opciones visibles duplicadas;
- inventario completo y sin duplicados de las 60 preguntas;
- escalas `100/50/0` y `100/66/33/0` obtenidas de la política central;
- secuencias confirmadas de las 39 preguntas generales ternarias, las tres binarias y p052;
- secuencia `100/66/33/0` para p038 y `100/50/0` para las 16 preguntas mentales ternarias.
