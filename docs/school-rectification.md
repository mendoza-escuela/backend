# Ficha institucional y rectificación anual

## Modelo compatible

La ficha conserva las columnas históricas y suma selecciones estructuradas sin
reinterpretar datos antiguos de forma ambigua:

- `educationLevel` almacena el **Tipo de educación**.
- `managementType` representa **Sector/Gestión** en el modelo actual.
- `scope` almacena el **Ámbito**.
- `shiftCatalogId` identifica la jornada y `shift` conserva su etiqueta para
  filtros y reportes heredados.
- `school_education_levels` almacena uno o más niveles y su matrícula.
- `characteristics.isMultigrade` y
  `characteristics.isInterculturalBilingual` admiten `true`, `false` o `null`
  cuando el dato se desconoce.
- La provincia es Mendoza por definición del programa; no se duplica como un
  valor editable en cada establecimiento.

Los registros históricos pueden conservar en `educationLevel` un nivel como
`Primario`, anterior a esta separación. Ese valor se muestra como dato legado,
pero no se convierte en `Educación común` ni se usa para inferir niveles
estructurados. La regularización masiva requiere un mapeo oficial por CUE.

El endpoint de catálogos devuelve `shifts` y `educationLevels` con su estructura
persistida, y además `managementTypes`, `scopes`, `educationTypes` y
`characteristics` como opciones `{ code, label }`. No se inventan catálogos de
departamentos ni localidades.

## Confirmación anual

Una nueva rectificación requiere Nombre, CUE, Director/a, Dirección, Localidad,
Ámbito, Tipo de educación y Jornada, según la respuesta funcional. La ficha
completa agrega Departamento como dato territorial, al menos un nivel y valores
conocidos para kiosco y servicio alimentario. Sector/Gestión, albergue,
contactos y características se validan si se informan, pero no bloquean una
evaluación por ausencia de una definición funcional que los declare
obligatorios.

El bloqueo por kiosco y servicio alimentario evita calcular la aplicabilidad
con un dato desconocido. Ambos campos fueron ratificados como obligatorios y
continúan formando parte del control previo a una evaluación.

La jornada textual se sincroniza con la etiqueta seleccionada. El snapshot de
rectificación incorpora jornada, niveles, banderas, contactos y características
sin modificar snapshots históricos. Para habilitar una evaluación se revisa
únicamente la última rectificación del año; una fotografía incompleta no se
salta en favor de otra anterior.

### Estado de confirmación y aptitud para evaluar

Los contratos de detalle de escuela y de etapas disponibles separan dos
conceptos que antes estaban combinados en `isRectified`:

- `isConfirmed`: existe al menos una confirmación para el año en curso.
- `isEvaluationReady`: el snapshot de la última confirmación contiene todos los
  datos que exige el control de evaluación.
- `missingFields`: lista estable `{ code, label }` de los datos que faltan en
  ese snapshot. Si todavía no existe una confirmación se devuelve vacía, ya
  que no corresponde inferir faltantes desde la ficha vigente.
- `rectifiedAt`: fecha de la última confirmación anual, aunque esa confirmación
  requiera una actualización.

`isRectified` se conserva temporalmente por compatibilidad y replica el valor
de `isEvaluationReady`; los clientes nuevos no deben usarlo para determinar si
existía una confirmación. Una confirmación histórica incompleta se representa,
por ejemplo, como `isConfirmed: true`, `isEvaluationReady: false` y conserva
su `rectifiedAt`. El backend bloquea el inicio de una presentación nueva con
esa ficha. Un borrador existente sólo adopta una confirmación posterior cuando
está lista para evaluar; su envío final continúa validando el snapshot histórico
vinculado y su aplicabilidad.

### Cierre desde administración

`PUT /api/admin/schools/:id/rectification` recibe `AdminRectifySchoolDto`. Al
contrato común agrega `schoolNumber`, `postalCode`, `phone` y `email` como
campos opcionales que también pueden enviarse en `null` para limpiarlos. El
endpoint actualiza la ficha, sus relaciones estructuradas, el snapshot y la
auditoría en una única transacción. `expectedUpdatedAt` se verifica con el
bloqueo de la escuela antes de efectuar cualquier escritura.

El endpoint escolar `PUT /api/schools/me/rectification` conserva
`RectifySchoolDto` y no admite esos campos administrativos. `isActive` no forma
parte de ninguno de los contratos de rectificación; su modificación permanece
en el endpoint administrativo de estado.

## Catálogos persistidos

La migración `SeedOfficialSchoolCatalogs1720375221000` incorpora de forma
idempotente las jornadas y niveles definidos para la ficha. Los textos
históricos sólo se asocian por igualdad después de normalizar mayúsculas,
acentos y espacios; no se realizan equivalencias aproximadas. Su rollback sólo
elimina filas sembradas que no estén referenciadas.

## Importación masiva pendiente de definición

El CSV histórico mantiene por compatibilidad una única columna `nivel` y una
matrícula total. No se reinterpretan esos datos como la nueva selección de uno
o más niveles porque el cliente todavía no definió cómo representar múltiples
niveles y sus matrículas en CSV/XLSX. Una escuela importada debe completar la
rectificación estructurada antes de iniciar una evaluación. Hasta contar con el
mapeo oficial por CUE, este flujo no regulariza ni sobrescribe automáticamente
los valores históricos.
