# Configuración versionada y métricas de evaluación

## Modelo y ciclo de vida

`evaluation_configurations` conserva una versión legible, autoría, fechas y el estado `draft`, `active` o `archived`. Sus cinco filas en `evaluation_star_ranges` expresan límites e inclusividad sin ambigüedad. Sólo los borradores son editables; activar una versión archiva la anterior en una transacción protegida con advisory lock y un índice único parcial. Las versiones activas o archivadas no se eliminan.

La migración `1720375218000-AddVersionedEvaluationConfiguration` carga idempotentemente `v1.0.0`: `[0,20]`, `(20,40]`, `(40,60]`, `(60,80]` y `(80,100]`; Salud Mental crítica para valores menores a 33 y máximo 4 estrellas cuando una base de 5 coincide con criticidad.

## Resultados históricos

Los nuevos resultados guardan estrella base, estrella final (`stars` se conserva como campo compatible), FK y versión de configuración, snapshot completo de rangos/umbrales, alertas y motivos. El bloqueo no modifica puntajes. Los resultados anteriores con estrellas nulas no se recalculan: siguen consultables, la API escolar informa que no están disponibles y el dashboard los excluye de la distribución indicando cuántos fueron excluidos.

## API y permisos

Todos los endpoints administrativos requieren JWT y rol `admin`:

- `GET/POST /admin/evaluation-configurations`
- `GET/PATCH /admin/evaluation-configurations/:id`
- `POST /admin/evaluation-configurations/:id/clone`
- `POST /admin/evaluation-configurations/:id/validate`
- `POST /admin/evaluation-configurations/:id/activate`
- `POST /admin/evaluation-configurations/:id/archive`
- `GET /admin/dashboard/results`
- `GET /admin/dashboard/results/star-distribution`

El resultado preliminar continúa en `GET /school/campaigns/:campaignId/submission/result`; la escuela se resuelve desde la sesión y nunca desde un identificador enviado por el cliente.

## Agregaciones y denominadores

Las consultas agregan en PostgreSQL resultados persistidos de presentaciones enviadas, aplican los mismos filtros territoriales/escolares del dashboard y no cargan respuestas. La respuesta declara universo, presentaciones enviadas, resultados vigentes y denominadores para promedios/distribución. La distribución usa estrellas finales y excluye nulos.

## Migración y pruebas

```bash
npm run migration:run
npm run migration:revert
npm run build
npm test -- --runInBand
npm run lint
```

El rollback elimina únicamente las nuevas columnas/tablas/índices. No modifica resultados ni respuestas preexistentes, aunque no debe ejecutarse si ya existen resultados que referencien configuraciones sin antes evaluar el impacto operativo.
