import { Injectable } from '@nestjs/common';
import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import { SurveyApplicabilityRule } from '../entities/survey-applicability-rule.entity';
import { SurveyVersion } from '../entities/survey-version.entity';
import {
  InstitutionalSurveyEvaluabilityPolicy,
  SurveyEvaluationProfile,
} from '../policies/institutional-survey-evaluability.policy';
import { ApplicabilityRulesService } from './applicability-rules.service';
import { SurveyStructureValidator } from './survey-structure-validator.service';

export type SurveyVersionCertification = Readonly<{
  valid: boolean;
  errors: string[];
  profile: SurveyEvaluationProfile;
  evaluable: boolean;
  evaluationErrors: string[];
}>;

export const INSTITUTIONAL_SURVEY_CERTIFICATION_FAILED_ERROR =
  'La versión institucional no pudo certificarse para evaluación.';

export const SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE_CODE =
  'SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE';

export const SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE_MESSAGE =
  'La versión seleccionada no es evaluable institucionalmente y no puede utilizarse en una etapa.';

/**
 * Certifica una versión completa para publicación y evaluación institucional.
 *
 * Es la única composición autorizada de estructura publicable, reglas de
 * aplicabilidad y contrato institucional. La versión debe cargarse con toda su
 * estructura, opciones, reglas y condiciones para que la decisión sea cerrada.
 */
@Injectable()
export class SurveyVersionCertificationService {
  constructor(
    private readonly structureValidator: SurveyStructureValidator,
    private readonly applicabilityRules: ApplicabilityRulesService,
    private readonly evaluabilityPolicy: InstitutionalSurveyEvaluabilityPolicy,
  ) {}

  certify(version: SurveyVersion): SurveyVersionCertification {
    const dimensions = this.toInput(version);
    const structuralErrors = this.structureValidator.inspect(dimensions, true);
    const applicabilityErrors = this.applicabilityRules.validateRules(
      this.rules(version),
    );
    const institutional = this.evaluabilityPolicy.inspect(dimensions);
    const institutionalErrors =
      institutional.profile === 'institutional' &&
      !institutional.evaluable &&
      institutional.evaluationErrors.length === 0
        ? [INSTITUTIONAL_SURVEY_CERTIFICATION_FAILED_ERROR]
        : institutional.evaluationErrors;
    const evaluationErrors = unique([
      ...structuralErrors,
      ...institutionalErrors,
      ...applicabilityErrors,
    ]);
    const errors = unique([
      ...structuralErrors,
      ...(institutional.profile === 'institutional' ? institutionalErrors : []),
      ...applicabilityErrors,
    ]);

    return {
      valid: errors.length === 0,
      errors,
      profile: institutional.profile,
      evaluable:
        institutional.profile === 'institutional' &&
        institutional.evaluable &&
        structuralErrors.length === 0 &&
        applicabilityErrors.length === 0 &&
        institutionalErrors.length === 0,
      evaluationErrors,
    };
  }

  private toInput(version: SurveyVersion): SurveyDimensionInputDto[] {
    return version.dimensions.map((dimension) => ({
      code: dimension.code,
      title: dimension.title,
      description: dimension.description,
      sections: dimension.sections.map((section) => ({
        code: section.code,
        title: section.title,
        description: section.description,
        questions: section.questions.map((question) => ({
          code: question.code,
          type: question.type,
          prompt: question.prompt,
          helpText: question.helpText,
          required: question.required,
          validation: question.validation,
          options: question.options.map((option) => ({
            value: option.value,
            label: option.label,
            helpText: option.helpText,
            score: option.score,
          })),
        })),
      })),
    }));
  }

  private rules(version: SurveyVersion): SurveyApplicabilityRule[] {
    return version.dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) =>
        section.questions.flatMap((question) =>
          (question.applicabilityRules ?? []).map((rule) => ({
            ...rule,
            conditions: rule.conditions ?? [],
          })),
        ),
      ),
    );
  }
}

function unique(errors: string[]): string[] {
  return [...new Set(errors)];
}
