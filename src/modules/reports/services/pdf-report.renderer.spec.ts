import type { IndividualReportViewModel } from '../report.types';
import { PdfReportRenderer } from './pdf-report.renderer';
import { RadarSvgService } from './radar-svg.service';

describe('PdfReportRenderer', () => {
  const renderer = new PdfReportRenderer();
  const view = reportView();

  it.each([
    ['individual report', () => renderer.report(view)],
    ['submission receipt', () => renderer.receipt(view)],
  ])('renders a valid PDF for the %s', async (_label, createDocument) => {
    const pdf = await renderPdf(createDocument());

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });

  it('uses Helvetica-compatible stars and repeatable, non-splitting rows', () => {
    const printer = (
      renderer as unknown as {
        printer: { createPdfKitDocument: (definition: unknown) => unknown };
      }
    ).printer;
    const create = jest
      .spyOn(printer, 'createPdfKitDocument')
      .mockReturnValue({});

    renderer.report(view);

    const definition = create.mock.calls[0][0];
    const serialized = JSON.stringify(definition);
    expect(serialized).toContain('4 estrellas');
    expect(serialized).toContain('Numerador: 80.00 - Denominador: 100');
    expect(serialized).toContain('Dirección de prueba');
    expect(serialized).toContain('Departamento histórico');
    expect(serialized).toContain('Gestión histórica');
    expect(serialized).toContain('Mañana');
    expect(serialized).not.toContain('★');
    expect(serialized).toContain('"headerRows":1');
    expect(serialized).toContain('"dontBreakRows":true');
    expect(serialized).toContain('"keepWithHeaderRows":1');
    create.mockRestore();
  });

  it('keeps textual identification for organizations without a supplied logo', () => {
    const printer = (
      renderer as unknown as {
        printer: { createPdfKitDocument: (definition: unknown) => unknown };
      }
    ).printer;
    const create = jest
      .spyOn(printer, 'createPdfKitDocument')
      .mockReturnValue({});
    const brandedView = {
      ...view,
      branding: {
        ...view.branding,
        organizations:
          'Gobierno de Mendoza · Salud · Dirección General de Escuelas · OPS/OMS',
        logos: ['data:image/png;base64,bG9nbw=='],
      },
    };

    renderer.report(brandedView);

    const definition = create.mock.calls[0][0];
    expect(JSON.stringify(definition)).toContain(
      'Gobierno de Mendoza · Salud · Dirección General de Escuelas · OPS/OMS',
    );
    create.mockRestore();
  });

  it('renders every page of a long institutional report', async () => {
    const longView = reportView();
    const sample = longView.survey.dimensions[0].sections[0].questions[0];
    longView.survey.dimensions[0].sections[0].questions = Array.from(
      { length: 80 },
      (_, index) => ({
        ...sample,
        id: `question-${index}`,
        code: `P${String(index + 1).padStart(3, '0')}`,
        prompt: `Pregunta institucional extensa ${index + 1}: ${'contenido verificable '.repeat(5)}`,
      }),
    );

    const pdf = await renderPdf(renderer.report(longView));
    const pageObjects =
      pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

    expect(pageObjects).toBeGreaterThan(2);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});

async function renderPdf(
  document: ReturnType<PdfReportRenderer['report']>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
  document.end();
  return completed;
}

function reportView(): IndividualReportViewModel {
  const dimension = {
    id: 'dimension-id',
    code: 'alimentacion_saludable',
    title: 'Alimentación saludable',
    description: null,
    order: 1,
    result: {
      numerator: '80.00',
      denominator: 100,
      score: '80.00',
      criticality: null,
    },
    sections: [
      {
        id: 'section-id',
        code: 'section-code',
        title: 'Sección de prueba',
        description: null,
        order: 1,
        questions: [
          {
            id: 'question-id',
            code: 'P01',
            type: 'single_choice' as const,
            prompt: 'Pregunta histórica de prueba',
            helpText: null,
            required: true,
            order: 1,
            validation: {},
            options: [],
            rules: [],
            applicability: {
              status: 'applicable' as const,
              reasonCode: null,
              reasonDescription: null,
              matchedRuleId: null,
              evaluatedAt: '2026-08-10T12:00:00.000Z',
              relevantSchoolFacts: {},
            },
            answer: {
              id: 'answer-id',
              optionId: null,
              value: 'Sí',
              selectedOption: null,
            },
            scoreUsed: '80.00',
          },
        ],
      },
    ],
  };
  return {
    school: {
      name: 'Escuela de prueba',
      cue: '5000000',
      directorName: 'Dirección de prueba',
      department: 'Departamento histórico',
      address: 'Calle de prueba 1',
      locality: 'Ciudad',
      managementType: 'Gestión histórica',
      scope: 'Urbano',
      educationLevel: 'Primario',
      shift: 'Mañana',
    },
    campaign: {
      id: 'campaign-id',
      name: 'Campaña 2026',
      startsAt: '2026-01-01T03:00:00.000Z',
      endsAt: '2026-12-31T02:59:59.999Z',
    },
    survey: {
      id: 'survey-id',
      code: 'EPS',
      name: 'Escuelas Promotoras de Salud',
      description: null,
      version: {
        id: 'version-id',
        number: 1,
        title: 'Versión 2026',
        instructions: null,
        publishedAt: '2026-01-01T12:00:00.000Z',
      },
      dimensions: [dimension],
    },
    submission: {
      id: 'submission-id',
      campaignId: 'campaign-id',
      schoolId: 'school-id',
      surveyVersionId: 'version-id',
      schoolRectificationId: null,
      submittedAt: '2026-08-10T12:00:00.000Z',
      originalRespondent: {
        id: 'user-id',
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
      },
    },
    result: {
      generalScore: '80.00',
      numerator: '80.00',
      denominator: 100,
      stars: {
        value: 4,
        ruleVersion: 'stars-v1',
        blockingReasons: [],
        alerts: [],
      },
    },
    algorithm: {
      version: 'evaluation-v1',
      calculatedAt: '2026-08-10T12:00:01.000Z',
    },
    branding: {
      programName: 'Escuelas Promotoras de Salud',
      organizations: 'Gobierno de Mendoza',
      logos: [],
      signer: null,
      signerPosition: null,
      signatureImage: null,
      legalText: null,
      verificationUrl: null,
    },
    radarSvg: new RadarSvgService().create([
      { title: dimension.title, score: 80 },
    ]),
  };
}
