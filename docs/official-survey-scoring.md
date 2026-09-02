# SUR-05 — Escalas oficiales de puntuación

## Regla funcional

Las respuestas funcionales finales definen dos escalas:

- escala general: `100/50/0` para óptimo, intermedio e inicial;
- Salud Mental: `100/66/33/0` para sus cuatro niveles.

El backend conserva estos perfiles como referencias descriptivas inmutables.
Las excepciones aprobadas forman parte de la matriz por pregunta: los puntajes
se validan según el código y el orden de sus opciones; no alcanza con que una
pregunta contenga los mismos valores en un orden distinto.

## Matriz cerrada

- `p001`–`p021`, `p024`, `p026`–`p037`, `p039`–`p040` y `p044`–`p046`:
  secuencia exacta `100/50/0`.
- `p022`, `p023` y `p025`: preguntas binarias con los extremos `100/0`.
- `p038`: excepción de cuatro opciones con secuencia `100/66/33/0`.
- `p041`–`p043`, `p047`–`p051` y `p053`–`p060`: preguntas ternarias
  de Salud Mental con secuencia `100/50/0`.
- `p052`: sus opciones están ordenadas de menor a mayor madurez y usan la
  secuencia exacta `0/33/66/100`.

La matriz clasifica una sola vez los sesenta códigos oficiales, sin omisiones
ni solapamientos. Los cuestionarios personalizados no están alcanzados por
esta matriz y conservan puntajes configurables dentro del rango `0`–`100`.

## Validación y publicación

El guardado de un borrador admite puntajes enteros entre `0` y `100`. La
validación previa y la publicación aplican la matriz exacta por código, incluida
la excepción de p038 y las preguntas ternarias de Salud Mental. Una
inconsistencia devuelve un error descriptivo y la publicación no cambia estados
ni archiva versiones.

Los sesenta códigos tienen un mapeo aprobado. Una versión que respete estas
secuencias ya no queda bloqueada por definiciones de puntuación. La
implementación no modifica resultados históricos ni requiere una migración de
base de datos.
