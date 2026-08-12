# SUR-05 — Escalas oficiales de puntuación

## Regla funcional

Las respuestas funcionales finales definen dos escalas:

- escala general: `100/50/0` para óptimo, intermedio e inicial;
- Salud Mental: `100/66/33/0` para sus cuatro niveles.

El backend conserva estos perfiles como constantes inmutables. Los puntajes se
validan según el código de pregunta y el orden de sus opciones; no alcanza con
que una pregunta contenga los mismos valores en un orden distinto.

## Matriz cerrada

- `p001`–`p021`, `p024`, `p026`–`p037`, `p039`–`p040` y `p044`–`p046`:
  secuencia exacta `100/50/0`.
- `p022`, `p023` y `p025`: preguntas binarias con los extremos `100/0`.
- `p052`: sus opciones están ordenadas de menor a mayor madurez y usan la
  secuencia exacta `0/33/66/100`.

La matriz clasifica una sola vez los sesenta códigos oficiales, sin omisiones
ni solapamientos. Los cuestionarios personalizados no están alcanzados por
esta matriz y conservan puntajes configurables dentro del rango `0`–`100`.

## Definiciones pendientes

No se infieren puntajes cuando la respuesta del cliente no alcanza para
asociar cada alternativa con un valor:

- `p038` tiene cuatro alternativas, pero la escala general sólo define tres
  niveles. El cliente debe indicar la secuencia exacta de cuatro valores.
- `p041`–`p043`, `p047`–`p051` y `p053`–`p060` tienen tres alternativas, pero
  la escala de Salud Mental define cuatro niveles. El cliente debe indicar el
  puntaje exacto de cada alternativa.

Agregar o quitar opciones no resuelve estos pendientes: los bloqueos se
identifican por código de pregunta hasta recibir una definición funcional.

## Validación y publicación

El guardado de una versión institucional sólo admite valores pertenecientes al
perfil de su dimensión. La validación previa y la publicación agregan la matriz
por código y comprueban la secuencia completa. Una inconsistencia devuelve un
error descriptivo y la publicación no cambia estados ni archiva versiones.

Mientras `p038` y las dieciséis preguntas mentales indicadas sigan sin mapeo
aprobado, el banco oficial puede mantenerse como borrador pero no publicarse.
La implementación no modifica resultados históricos ni requiere una migración
de base de datos.
