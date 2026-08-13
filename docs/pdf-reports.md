# Reportes institucionales PDF y Excel

## Alcance

Los reportes y comprobantes se construyen en backend a partir del snapshot
histórico de evaluación. El frontend no envía HTML, imágenes ni capturas del
radar. `IndividualReportService` construye un ViewModel independiente y
`PdfReportRenderer` se limita a representarlo.

El snapshot de evaluación continúa siendo la autoridad del reporte. Para
resultados históricos que no conservaron `department` o `managementType`, el
ViewModel completa únicamente el campo ausente: primero desde
`survey_submissions.school_profile_snapshot` y, si tampoco está allí, desde la
rectificación histórica vinculada. Esta última sólo se acepta cuando su
identificador y escuela coinciden con la presentación y no contradice el
identificador guardado en el resultado. La resolución no consulta la ficha
escolar vigente, no modifica los snapshots originales y no persiste datos.

## Dependencia elegida

Se incorporó `pdfmake` como única dependencia directa específica para PDF.
Internamente utiliza PDFKit, pero agrega una capa declarativa para tablas,
columnas, paginación, encabezados, pies y SVG. Usar PDFKit directamente habría
requerido implementar manualmente esas reglas de layout, cortes de página y
tablas, aumentando el código propio y el riesgo de superposiciones en reportes
largos.

La prueba técnica versionada `pdf-report.renderer.spec.ts` genera tanto el
reporte como el comprobante, incluye el radar SVG y verifica que ambos streams
producen un documento `%PDF` no vacío. El renderer usa las fuentes estándar
Helvetica, por lo que no incorpora ni distribuye archivos de fuentes privados.

Los colores se consumen exclusivamente desde `report-theme.ts`, compartido por
las plantillas y el radar SVG. Sus valores coinciden con los tokens
institucionales del frontend. REM sólo podrá incorporarse al renderer si se
reciben los archivos oficiales y una licencia que autorice su redistribución.

## Identidad institucional

`ReportBrandingProvider` acepta únicamente imágenes PNG/JPEG existentes. Mientras
se esperan los activos definitivos, usa por defecto los logos provisionales
versionados de Gobierno de Mendoza y OPS:

```text
assets/brand/official/mendoza/marca-gobierno-mendoza.png
assets/brand/official/ops/ops-logo.jpeg
```

`REPORT_LOGO_MENDOZA_PATH` y `REPORT_LOGO_OPS_PATH` permiten reemplazarlos sin
modificar código. `REPORT_LOGO_HEALTH_PATH` y `REPORT_LOGO_DGE_PATH` siguen siendo
opcionales. Una ruta configurada sólo se incorpora si existe y es PNG o JPEG. Si
un activo no está disponible, el documento conserva la identificación textual;
la firma también se omite si no fue configurada.

La línea de organismos se imprime aun cuando existan logos, por lo que Salud y
la Dirección General de Escuelas permanecen identificadas por nombre hasta que
se entreguen sus variantes gráficas autorizadas.

Las variables admitidas están documentadas en `backend/.env.example` bajo el
prefijo `REPORT_`.

Los reportes se generan sobre fondo claro. Cada override `REPORT_LOGO_*_PATH`
debe apuntar a una variante autorizada para ese fondo y contar con procedencia
documentada. Los activos provisionales podrán sustituirse cuando el cliente
entregue las versiones definitivas.

## Descarga Excel para la escuela (EXP-02)

`GET /api/school/campaigns/:campaignId/submission/report.xlsx` descarga un
único libro institucional con cuatro hojas:

- `Resumen`: ficha, etapa, envío, resultado y trazabilidad del cálculo.
- `Dimensiones`: numerador, denominador, puntaje y criticidad persistidos.
- `Respuestas`: sólo preguntas aplicables y sus respuestas declaradas.
- `Exclusiones`: preguntas excluidas y motivo histórico, sin exponer una
  eventual respuesta residual.

La ruta requiere rol `school`, contraseña definitiva y una asociación 1:1
vigente. No acepta `schoolId`: el establecimiento se obtiene desde la sesión y
`IndividualReportService` verifica asignación, presentación enviada y snapshot
de resultado. De esta manera no es posible pedir el archivo de otra escuela ni
exportar un borrador.

El libro se materializa completamente con `Workbook.xlsx.writeBuffer()` antes
de enviarlo. Esto evita respuestas ZIP truncadas y permite fijar `Content-Length`.
El MIME es
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, el nombre
es `reporte-{cue}.xlsx`, la respuesta usa `Cache-Control: private, no-store` y
la descarga se registra como `INDIVIDUAL_XLSX_REPORT_DOWNLOADED` sin guardar
respuestas en la auditoría.

Todo texto dinámico pasa por `spreadsheetSafeCell`; también se neutralizan
prefijos de fórmula precedidos por espacios, tabulaciones u otros caracteres de
control. Las fechas visibles usan `America/Argentina/Mendoza`, evitando mostrar
como día siguiente en UTC el cierre civil de una etapa.
