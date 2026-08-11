# SUR-02 — Cuestionario institucional de 60 preguntas

## Fuente y precedencia

La planilla consolidada se genera desde:

1. `Arquitectura de datos para la App de Escuelas Promotoras de Salud Mendoza. DEFINITIVA`, que contiene el banco original de 60 preguntas.
2. `Respuestas Funcionales Final`, que prevalece ante cualquier contradicción con la fuente anterior.

El artefacto de revisión y futura importación es `docs/plantilla-cuestionario-completo.xlsx` y se regenera con:

```bash
npm run survey:generate-official-template
```

La generación valida la planilla con el mismo importador que usa la API. La estructura fuente debe conservar seis dimensiones, siete secciones, sesenta preguntas y 179 opciones puntuables. Mientras falten las definiciones de SUR-05, la vista previa debe rechazar exclusivamente las 52 filas sin puntaje de las 17 preguntas pendientes; cualquier otro error detiene la generación.

## Decisiones incorporadas

- Exactamente 60 preguntas de selección simple, con códigos estables `p001` a `p060`.
- Seis dimensiones oficiales. Las preguntas 41, 42 y 43 pertenecen a `salud_mental`.
- Todas las preguntas aplicables son obligatorias.
- No se incluyen respuestas genéricas “Otro” ni “No aplica”.
- p010 usa 10 minutos para desayuno/merienda y 30 minutos para almuerzo tanto en el enunciado como en la opción óptima.
- p020 conserva en la hoja `Fuente` la nueva alternativa “El establecimiento no cuenta con Comedor”. No se presenta como respuesta puntuable mientras no se defina su tratamiento de exclusión.
- p032 usa el texto y las frecuencias de consumo definidos en la respuesta funcional final.
- p046 usa “No se abordan estos temas.” como tercera opción y ya no contiene alternativas duplicadas.
- La escala general confirmada es `100/50/0` y la escala de Salud Mental es `100/66/33/0`.
- Los puntajes se obtienen de la misma política central que usa la validación de publicación; el generador no conserva una copia independiente de las escalas o la matriz.

La hoja `Fuente` conserva 197 alternativas para trazabilidad. La hoja `Cuestionario` excluye las respuestas de infraestructura que deben resolverse mediante aplicabilidad y contiene las 179 opciones que el backend podrá importar una vez completados los puntajes pendientes.

## Inventario de puntuación

La hoja `Mapeo de puntajes` contiene una fila por pregunta y muestra la escala oficial, la secuencia aplicada según el orden actual de las opciones, el estado y la definición faltante. La matriz vigente es:

| Preguntas | Tipo | Mapeo según orden de opciones | Estado |
| --- | --- | --- | --- |
| p001–p021, p024, p026–p037, p039–p040 y p044–p046 | General, tres opciones | `100/50/0` | Confirmado |
| p022, p023 y p025 | General, dos opciones | `100/0` | Confirmado |
| p038 | General, cuatro opciones | Sin puntajes | Pendiente |
| p052 | Salud Mental, cuatro opciones ordenadas de menor a mayor desarrollo | `0/33/66/100` | Confirmado |
| p041–p043, p047–p051 y p053–p060 | Salud Mental, tres opciones | Sin puntajes | Pendiente |

Las celdas pendientes permanecen vacías y resaltadas. No se asignan secuencias como `100/50/0/0` o `100/66/0`, porque repetir u omitir un nivel de la escala sería una regla de negocio no aprobada.

## Definiciones necesarias antes de publicar

La planilla no puede importarse ni publicarse hasta que el cliente cierre estas decisiones. El bloqueo es intencional: evita persistir puntajes provisionales en un borrador que luego pueda confundirse con contenido aprobado.

1. **p038:** asignar un puntaje exacto a sus cuatro respuestas. La escala general definida es `100/50/0`, pero la pregunta posee cuatro niveles.
2. **Preguntas de Salud Mental con tres respuestas:** definir si la alternativa intermedia vale `66`, `33` u otro valor aprobado. La escala funcional enumera `100/66/33/0`, pero no indica cómo aplicarla a tres alternativas.
3. **Kiosco:** resolver la contradicción interna de `Respuestas Funcionales Final`: primero identifica p021–p027 (siete preguntas) y luego indica que el filtro excluye nueve, sin nombrar las dos restantes.
4. **Comedor/jornada:** enumerar exactamente qué preguntas se excluyen y la expresión aplicable. La respuesta funcional describe el criterio, pero no aporta una correspondencia completa pregunta–condición.
5. **p041:** confirmar si “Se trabaja de forma limpia, transversal y sostenida” es el texto intencional.
6. **p051:** confirmar la primera alternativa, actualmente referida a adultos designados y horas programáticas aunque la pregunta trata sobre participación familiar.
7. **p059:** confirmar la redacción “Incluido de forma con implementación específica activa y sostenida”.

Hasta recibir estas definiciones se conservan los datos de la fuente y se identifican como pendientes; no se inventan textos, puntajes ni reglas de exclusión. Una vez aprobados los dos mapeos faltantes, deben incorporarse primero a la política central y luego regenerarse la planilla.

Esta restricción no es solamente documental. Cuando una versión conserva al menos un código oficial de dimensión o de pregunta (`p001`–`p060`), `POST /api/admin/surveys/:surveyId/versions/:versionId/publish` ejecuta la política de preparación oficial y devuelve `400` con estos pendientes. Esto impide evadir la validación quitando o renombrando dimensiones de un banco incompleto. Esos identificadores forman el espacio de nombres reservado del instrumento institucional; los cuestionarios personalizados deben usar códigos propios. El endpoint de validación previa devuelve la misma lista.

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
- puntajes vacíos para p038 y las 16 preguntas mentales de tres opciones, sin valores provisionales.
