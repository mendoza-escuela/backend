# Decisión técnica para reportes PDF

## Alcance

Los reportes y comprobantes se construyen en backend a partir del snapshot
histórico de evaluación. El frontend no envía HTML, imágenes ni capturas del
radar. `IndividualReportService` construye un ViewModel independiente y
`PdfReportRenderer` se limita a representarlo.

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

## Identidad institucional

`ReportBrandingProvider` acepta únicamente imágenes PNG/JPEG existentes en las
rutas configuradas. Si faltan logos o firma oficiales, el documento usa los
nombres institucionales en texto y omite la firma; no recrea marcas ni produce
activos aproximados.

Las variables admitidas están documentadas en `backend/.env.example` bajo el
prefijo `REPORT_`.
