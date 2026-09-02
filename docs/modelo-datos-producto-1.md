# Modelo de datos — Producto 1

## Propósito y alcance

Este documento describe el modelo relacional implementado para el Producto 1 de Escuelas Promotoras de Salud. La fuente de verdad ejecutable son las entidades TypeORM de `src/modules/` y las migraciones versionadas de `src/migrations/`.

La base oficial es PostgreSQL. `synchronize` permanece desactivado y todo cambio estructural se aplica mediante migraciones.

## Identidad, acceso y auditoría

| Tabla                            | Propósito                                                 | Relaciones y restricciones principales                                                             |
| -------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `users`                          | Cuentas, rol, estado y seguridad de acceso.               | Correo único sin distinguir mayúsculas/minúsculas. La contraseña se conserva únicamente como hash. |
| `user_schools`                   | Asociación entre una cuenta Escuela y un establecimiento. | Una escuela por usuario y un usuario por escuela. FKs con borrado en cascada.                      |
| `auth_sessions`                  | Sesiones JWT revocables.                                  | Token identificador único, vencimiento y revocación; FK a usuario.                                 |
| `password_reset_tokens`          | Recuperación segura de contraseña.                        | Sólo se guarda el hash del token; vencimiento y uso único.                                         |
| `audit_logs`                     | Trazabilidad funcional y de seguridad.                    | Actor opcional, acción, tipo/ID de entidad y cambios en JSONB. No contiene contraseñas ni tokens.  |
| `school_user_assignment_history` | Historial de asignación y reemplazo de cuentas escolares. | Conserva usuario anterior, nuevo usuario, actor y fecha.                                           |

Los dos roles funcionales validados son:

- **Escuela** (`school`): acceso exclusivo al establecimiento asociado, rectificación de su ficha, carga del cuestionario y consulta de su diagnóstico individual.
- **Administrador Central — Ministerio/DGE** (`admin`): acceso a la base consolidada, alertas críticas, monitoreo y reportes territoriales.

No forman parte del alcance vigente perfiles provinciales, analistas ni un superadministrador separado. El correo institucional es el identificador único de inicio de sesión. La relación técnica es cuenta Escuela ↔ establecimiento: ambos índices únicos de `user_schools` garantizan un vínculo 1:1 en las dos direcciones.

## Establecimientos y rectificaciones

| Tabla                                   | Propósito                                                | Relaciones y restricciones principales                                                                         |
| --------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `schools`                               | Padrón institucional y características actuales.         | CUE único; índices territoriales e institucionales; características ternarias para kiosco, comedor y albergue. |
| `school_contacts`                       | Referente respondente y referente de promoción de salud. | Tipo único por escuela.                                                                                        |
| `school_shift_catalog`                  | Catálogo versionable de jornadas.                        | Código único, orden y estado.                                                                                  |
| `education_level_catalog`               | Catálogo de niveles educativos.                          | Código único, orden y estado.                                                                                  |
| `school_education_levels`               | Niveles y matrícula actuales por escuela.                | Nivel y orden únicos dentro de la escuela.                                                                     |
| `school_rectifications`                 | Constancias históricas autocontenidas por período.       | Snapshot JSONB, actor, año y fecha. Se permiten varias confirmaciones por año por diseño actual.               |
| `school_rectification_education_levels` | Detalle histórico de niveles de una rectificación.       | Copia código, etiqueta, matrícula y orden para no depender del catálogo futuro.                                |

Las presentaciones no calculan aplicabilidad con la ficha actual: copian y congelan el snapshot de la rectificación asociada. Los triggers de PostgreSQL protegen la inmutabilidad de rectificaciones y presentaciones enviadas.

## Cuestionarios y aplicabilidad

| Tabla                             | Propósito                                                | Relaciones y restricciones principales                                       |
| --------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `surveys`                         | Definición general del instrumento.                      | Código único y estado activo.                                                |
| `survey_versions`                 | Versiones borrador, publicadas o archivadas.             | Número único por cuestionario y una sola versión publicada por cuestionario. |
| `survey_dimensions`               | Seis dimensiones oficiales ordenadas.                    | Código y orden únicos por versión.                                           |
| `survey_sections`                 | Agrupación de preguntas.                                 | Código y orden únicos por dimensión.                                         |
| `survey_questions`                | Preguntas, tipo, obligatoriedad y validación.            | Código y orden únicos por sección.                                           |
| `survey_options`                  | Opciones y puntaje de 0 a 100.                           | Valor y orden únicos por pregunta.                                           |
| `survey_applicability_rules`      | Acción condicional (`show`/`omit`) y acción por defecto. | Orden único por pregunta.                                                    |
| `survey_applicability_conditions` | Condiciones sobre hechos del snapshot escolar.           | Orden único por regla; valor esperado JSONB.                                 |

Una versión publicada y todos sus descendientes son inmutables. Una corrección funcional se realiza clonando y publicando una nueva versión; las etapas existentes conservan la referencia histórica.

La plantilla incorporada en código crea las seis dimensiones, pero deliberadamente no inventa secciones, preguntas ni opciones. El banco definitivo se incorpora mediante una planilla CSV/XLSX validada. Para el instrumento institucional, cada pregunta importada es de selección simple, debe tener código único, texto, obligatoriedad, orden y opciones puntuadas. Los borradores admiten enteros de `0` a `100`; para publicar, cada código debe respetar su secuencia oficial exacta, incluidas p038 (`100/66/33/0`), las preguntas mentales ternarias (`100/50/0`) y p052 (`0/33/66/100`). No se permiten opciones “Otro” ni “No aplica”.

El motor condicional permite combinar condiciones con lógica `all`/`any`, aplicar acciones `show`/`omit` y definir una acción predeterminada. Los hechos disponibles son existencia de kiosco, comedor/servicio alimentario y albergue, jornada, niveles educativos y matrícula total. Las reglas se procesan por prioridad y se utiliza la primera coincidencia. Si falta un dato que podría cambiar la decisión, la pregunta queda incompleta en vez de asumir una respuesta.

Para las preguntas oficiales `p021` a `p027`, la política validada es:

- `has_kiosk=true`: pregunta aplicable.
- `has_kiosk=false`: pregunta excluida del numerador y denominador.
- `has_kiosk=null`: aplicabilidad incompleta; el envío queda bloqueado hasta rectificar la ficha.

Ésta es la única correspondencia pregunta/condición cerrada hasta ahora. El informe de QA menciona condiciones de comedor y jornada, pero no identifica los códigos ni la expresión funcional que deben aplicar; esas asociaciones requieren la planilla o definición oficial antes de publicarse.

## Etapas y presentaciones

| Tabla                               | Propósito                                        | Relaciones y restricciones principales                                              |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `campaigns`                         | Ciclos anuales o semestrales.                    | Referencia una versión publicada y recorre `draft → active → closed → archived`.    |
| `campaign_schools`                  | Universo explícito de escuelas de una etapa.     | Par etapa/escuela único; baja lógica, fuente y actor de asignación.                 |
| `survey_submissions`                | Borrador o envío único de una escuela por etapa. | Par etapa/escuela único; snapshot escolar y respondente original.                   |
| `survey_answers`                    | Respuestas estructuradas de la presentación.     | Una respuesta por pregunta y presentación; opción o valor según tipo.               |
| `submission_question_applicability` | Decisión congelada para cada pregunta.           | Una decisión por pregunta/presentación, motivo, hechos relevantes y regla aplicada. |

En borrador se pueden incorporar, reactivar y quitar escuelas, salvo que ya
exista una presentación. Durante una etapa activa el universo es aditivo: el
administrador puede incorporar nuevas escuelas habilitadas, con fecha, origen,
actor y auditoría, pero no quitar las existentes. Las etapas cerradas o
archivadas son de sólo lectura. La presentación enviada, su identidad, snapshot,
respuestas y decisiones quedan protegidos para preservar el histórico.

## Evaluación y resultados

| Tabla                          | Propósito                                                | Relaciones y restricciones principales                                                                 |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `evaluation_configurations`    | Versión de rangos, umbral crítico y límite de estrellas. | Código único y una sola configuración activa.                                                          |
| `evaluation_star_ranges`       | Cinco rangos contiguos de estrellas.                     | Estrella y orden únicos por configuración.                                                             |
| `evaluation_results`           | Resultado vigente y snapshot autocontenido de cálculo.   | Un resultado por presentación; numerador, denominador, promedio, estrellas, algoritmo y configuración. |
| `evaluation_dimension_results` | Resultado y criticidad por dimensión.                    | Una fila por dimensión/resultado, con componentes verificables.                                        |

El backend calcula exclusivamente con preguntas aplicables. Cada resultado conserva el cuestionario, respuestas, exclusiones, puntajes utilizados, configuración y versión de algoritmo necesarias para reproducir y auditar la salida.

La reparación excepcional de datos de aplicabilidad requiere una vista previa con huella de estado, confirmación explícita, bloqueo transaccional y auditoría completa del antes/después. No se ejecuta automáticamente durante despliegues ni migraciones.

## Relaciones principales

```text
users ──< auth_sessions
  │
  └── user_schools >── schools ──< school_rectifications
                              │
surveys ──< survey_versions ──┼──< campaigns ──< campaign_schools >── schools
          │                   │
          └──< dimensions ──< sections ──< questions ──< options
                                               │
                                               └──< applicability_rules ──< conditions

campaigns ──< survey_submissions >── schools
                    │
                    ├──< survey_answers
                    ├──< submission_question_applicability
                    └── evaluation_results ──< evaluation_dimension_results
```

## Integridad, seguridad y operación

- Las FKs impiden eliminar definiciones utilizadas por etapas, presentaciones o resultados.
- Los índices únicos constituyen la defensa final ante solicitudes concurrentes.
- Los DTO y servicios validan antes de persistir; las restricciones PostgreSQL vuelven a validar la integridad.
- Las operaciones compuestas usan transacciones y bloqueos pesimistas cuando existe riesgo de carrera.
- Los snapshots históricos son JSONB controlado; las entradas libres no sustituyen relaciones estructuradas.
- Los datos sensibles no se exponen directamente desde entidades ni se incluyen en auditoría.
- Las migraciones deben ejecutarse como paso previo al inicio de la API; la aplicación mantiene `migrationsRun` y `synchronize` desactivados para impedir cambios implícitos de esquema.

## Pendientes de validación externa

- Aprobación formal del documento de alcance funcional.
- Planilla oficial definitiva del cuestionario: textos, opciones, puntajes, obligatoriedad, orden y correspondencia de condiciones adicionales a kiosco.
- Catálogos oficiales productivos de jornadas y niveles.
- Política institucional de backups: destino cifrado, frecuencia, retención, restauración y responsables.
- Acceso y parámetros del ambiente QA para ejecutar migraciones, auditar datos y validar HTTPS/despliegue.
- Credenciales SMTP y textos finales para habilitar el envío real de recuperación de contraseña.
