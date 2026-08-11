# SUR-04 — Obligatoriedad de preguntas aplicables

## Regla funcional

En el cuestionario institucional, toda pregunta que resulte aplicable para la
escuela debe tener una respuesta antes del envío final. Una pregunta excluida
por el motor de aplicabilidad no se muestra, no se exige y no integra la
completitud ni los agregados.

Los cuestionarios personalizados conservan la configuración `required` de
cada pregunta. SUR-04 no convierte sus preguntas opcionales en obligatorias.
Para diferenciarlos sin alterar el modelo de datos, los seis códigos de
dimensión oficiales y los códigos `p001`–`p060` quedan reservados para el banco
institucional; un cuestionario personalizado debe usar sus propios códigos.

## Protección al publicar

La versión se considera institucional cuando conserva al menos uno de los
códigos de dimensión o de pregunta oficiales. Esto evita que renombrar una
dimensión permita eludir las reglas mientras el banco `p001`–`p060` siga
presente. Tanto la validación previa como la publicación comprueban que:

- existan las seis dimensiones oficiales y no haya dimensiones renombradas;
- existan exactamente las preguntas `p001` a `p060`, sin faltantes, códigos
  desconocidos ni duplicados;
- las sesenta preguntas tengan `required = true`.

`GET /api/admin/surveys/:surveyId/versions/:versionId/validation` devuelve la
lista completa de inconsistencias. El endpoint de publicación devuelve `400`
y no cambia el estado de la versión si encuentra alguna de ellas.

## Protección al enviar

`POST /api/school/campaigns/:campaignId/submission/submit` vuelve a resolver la
aplicabilidad y exige una respuesta para cada pregunta marcada como obligatoria
en la versión publicada. Como la publicación oficial sólo admite las sesenta
preguntas con `required = true`, toda pregunta institucional aplicable queda
alcanzada por esta validación. Las excluidas no se exigen.

Las versiones ya publicadas se mantienen inmutables: SUR-04 no reinterpreta ni
reescribe retrospectivamente su configuración. El botón de envío puede
permanecer disponible mientras se edita; el frontend valida el estado local y
el backend conserva la validación definitiva y transaccional al enviar.

## Persistencia

La implementación no modifica ni elimina cuestionarios, respuestas o
resultados existentes y no requiere una migración de base de datos.

Las regresiones automatizadas cubren bancos incompletos o renombrados,
preguntas oficiales opcionales, encuestas personalizadas, preguntas aplicables
sin respuesta y preguntas excluidas.
