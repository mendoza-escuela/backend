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
    const document = createDocument();
    const chunks: Buffer[] = [];
    const completed = new Promise<Buffer>((resolve, reject) => {
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });

    document.end();
    const pdf = await completed;

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });
});

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
      address: 'Calle de prueba 1',
      locality: 'Ciudad',
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
