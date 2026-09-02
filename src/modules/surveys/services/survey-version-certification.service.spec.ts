import { SurveyVersion } from '../entities/survey-version.entity';
import { InstitutionalSurveyEvaluabilityPolicy } from '../policies/institutional-survey-evaluability.policy';
import { ApplicabilityRulesService } from './applicability-rules.service';
import { SurveyStructureValidator } from './survey-structure-validator.service';
import {
  INSTITUTIONAL_SURVEY_CERTIFICATION_FAILED_ERROR,
  SurveyVersionCertificationService,
} from './survey-version-certification.service';

describe('SurveyVersionCertificationService', () => {
  const structureValidator = { inspect: jest.fn() };
  const applicabilityRules = { validateRules: jest.fn() };
  const evaluabilityPolicy = { inspect: jest.fn() };
  let service: SurveyVersionCertificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    structureValidator.inspect.mockReturnValue([]);
    applicabilityRules.validateRules.mockReturnValue([]);
    evaluabilityPolicy.inspect.mockReturnValue({
      profile: 'generic',
      evaluable: false,
      evaluationErrors: ['La versión genérica no es evaluable.'],
    });
    service = new SurveyVersionCertificationService(
      structureValidator as unknown as SurveyStructureValidator,
      applicabilityRules as unknown as ApplicabilityRulesService,
      evaluabilityPolicy as unknown as InstitutionalSurveyEvaluabilityPolicy,
    );
  });

  it('mantiene publicable una versión genérica válida, pero no la certifica para evaluación', () => {
    const certification = service.certify(emptyVersion());

    expect(certification).toEqual({
      valid: true,
      errors: [],
      profile: 'generic',
      evaluable: false,
      evaluationErrors: ['La versión genérica no es evaluable.'],
    });
    expect(structureValidator.inspect).toHaveBeenCalledWith([], true);
  });

  it('compone y deduplica estructura, aplicabilidad y política institucional', () => {
    structureValidator.inspect.mockReturnValue([
      'Estructura inválida.',
      'Error compartido.',
    ]);
    applicabilityRules.validateRules.mockReturnValue([
      'Aplicabilidad inválida.',
      'Error compartido.',
    ]);
    evaluabilityPolicy.inspect.mockReturnValue({
      profile: 'institutional',
      evaluable: false,
      evaluationErrors: ['Puntaje oficial incompleto.', 'Error compartido.'],
    });

    expect(service.certify(emptyVersion())).toEqual({
      valid: false,
      errors: [
        'Estructura inválida.',
        'Error compartido.',
        'Puntaje oficial incompleto.',
        'Aplicabilidad inválida.',
      ],
      profile: 'institutional',
      evaluable: false,
      evaluationErrors: [
        'Estructura inválida.',
        'Error compartido.',
        'Puntaje oficial incompleto.',
        'Aplicabilidad inválida.',
      ],
    });
  });

  it('cierra publicación y evaluación ante una decisión institucional inconsistente', () => {
    evaluabilityPolicy.inspect.mockReturnValue({
      profile: 'institutional',
      evaluable: false,
      evaluationErrors: [],
    });

    expect(service.certify(emptyVersion())).toEqual({
      valid: false,
      errors: [INSTITUTIONAL_SURVEY_CERTIFICATION_FAILED_ERROR],
      profile: 'institutional',
      evaluable: false,
      evaluationErrors: [INSTITUTIONAL_SURVEY_CERTIFICATION_FAILED_ERROR],
    });
  });
});

function emptyVersion(): SurveyVersion {
  return { dimensions: [] } as unknown as SurveyVersion;
}
