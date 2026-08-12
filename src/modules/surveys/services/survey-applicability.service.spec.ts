import { ConflictException } from '@nestjs/common';
import { SchoolRectificationSnapshot } from '../../schools/entities/school-rectification.entity';
import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
} from '../entities/survey-applicability-rule.entity';
import { SurveyQuestion } from '../entities/survey-question.entity';
import { SurveyVersion } from '../entities/survey-version.entity';
import {
  createOfficialKioskApplicabilityRule,
  OFFICIAL_KIOSK_QUESTION_CODES,
} from '../policies/official-survey-applicability.policy';
import { ApplicabilityEngine } from './applicability-engine.service';
import { SurveyApplicabilityService } from './survey-applicability.service';

describe('SurveyApplicabilityService', () => {
  const service = new SurveyApplicabilityService(new ApplicabilityEngine());
  const evaluatedAt = new Date('2026-07-30T12:00:00.000Z');

  it('considera visible una pregunta sin reglas y conserva su obligatoriedad', () => {
    const version = versionWith(question('q1', []));
    const result = service.evaluate(version, snapshot(), evaluatedAt);

    expect(result.applicableQuestionIds).toEqual(new Set(['q1']));
    expect(version.dimensions[0].sections[0].questions[0].required).toBe(true);
    expect(result.decisions[0]).toMatchObject({
      status: 'applicable',
      reasonCode: 'NO_APPLICABILITY_RULES',
    });
  });

  it('evalúa varias preguntas en lote y conserva el motivo de exclusión', () => {
    const version = versionWith(
      question('visible', []),
      question('excluded', [omitWhen('has_kiosk', false)]),
      question('visible-by-default', [omitWhen('is_boarding', true)]),
    );
    const result = service.evaluate(
      version,
      snapshot({ hasKiosk: false, isBoarding: false }),
      evaluatedAt,
    );

    expect(result.applicableQuestionIds).toEqual(
      new Set(['visible', 'visible-by-default']),
    );
    expect(result.excludedQuestionIds).toEqual(new Set(['excluded']));
    expect(result.decisions[1]).toMatchObject({
      appliedRuleId: 'rule-has_kiosk',
      reasonCode: 'MATCHED_EXCLUSION_RULE',
      evaluatedAt,
      relevantSchoolFacts: { has_kiosk: false },
    });
    expect(result.decisions[1].reasonDescription).toContain('Coincidió');
  });

  it('diferencia false de un dato escolar no informado', () => {
    const version = versionWith(
      question('conditional', [omitWhen('has_kiosk', false)]),
    );

    const falseResult = service.evaluate(
      version,
      snapshot({ hasKiosk: false }),
      evaluatedAt,
    );
    const missingResult = service.evaluate(
      version,
      snapshot({ hasKiosk: null }),
      evaluatedAt,
    );

    expect(falseResult.status).toBe('ready');
    expect(falseResult.excludedQuestionIds.has('conditional')).toBe(true);
    expect(missingResult.status).toBe('incomplete');
    expect(missingResult.incompleteQuestionIds.has('conditional')).toBe(true);
    expect(missingResult.missingFields).toEqual([
      { code: 'has_kiosk', label: 'Tiene kiosco' },
    ]);
  });

  it('informa una ficha rectificada inexistente sin inventar valores', () => {
    const result = service.evaluate(
      versionWith(question('q1', [])),
      null,
      evaluatedAt,
    );

    expect(result.status).toBe('incomplete');
    expect(result.missingFields[0]).toEqual({
      code: 'school_profile_snapshot',
      label: 'Ficha escolar rectificada',
    });
    expect(result.applicableQuestionIds.has('q1')).toBe(true);
  });

  it('no incorpora reglas productivas cuando la versión no las contiene', () => {
    const result = service.evaluate(
      versionWith(question('q1', []), question('q2', [])),
      snapshot({ hasKiosk: false, hasFoodService: false }),
      evaluatedAt,
    );

    expect(result.excludedQuestionIds.size).toBe(0);
    expect(result.applicableQuestionIds.size).toBe(2);
  });

  it('bloquea el envío final de una versión oficial sin reglas de kiosco', () => {
    expect(() =>
      service.assertVersionApplicabilitySafe(
        officialKioskVersion(false),
        snapshot({ hasKiosk: false }),
      ),
    ).toThrow(ConflictException);

    try {
      service.assertVersionApplicabilitySafe(
        officialKioskVersion(false),
        snapshot({ hasKiosk: false }),
      );
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'SURVEY_VERSION_APPLICABILITY_NOT_READY',
      });
    }
  });

  it('permite el envío final cuando p021-p027 cumplen la regla aprobada', () => {
    expect(() =>
      service.assertVersionApplicabilitySafe(
        officialKioskVersion(true),
        snapshot({ hasKiosk: false }),
      ),
    ).not.toThrow();
  });

  it('no bloquea una escuela con kiosco si la versión histórica omitió las reglas', () => {
    expect(() =>
      service.assertVersionApplicabilitySafe(
        officialKioskVersion(false),
        snapshot({ hasKiosk: true }),
      ),
    ).not.toThrow();
  });
});

function question(
  id: string,
  applicabilityRules: SurveyQuestion['applicabilityRules'],
) {
  return {
    id,
    code: id,
    required: true,
    applicabilityRules,
    options: [],
  } as unknown as SurveyQuestion;
}

function omitWhen(
  feature: string,
  expectedValue: string | boolean,
): SurveyQuestion['applicabilityRules'][number] {
  return {
    id: `rule-${feature}`,
    groupOperator: ApplicabilityGroupOperator.All,
    action: ApplicabilityAction.Omit,
    defaultAction: ApplicabilityAction.Show,
    order: 0,
    conditions: [
      {
        id: `condition-${feature}`,
        feature,
        operator: 'equals',
        expectedValue,
        order: 0,
      },
    ],
  } as SurveyQuestion['applicabilityRules'][number];
}

function versionWith(...questions: SurveyQuestion[]) {
  return {
    id: 'version-id',
    dimensions: [
      {
        sections: [{ questions }],
      },
    ],
  } as SurveyVersion;
}

function officialKioskVersion(withRules: boolean) {
  const version = versionWith(
    ...OFFICIAL_KIOSK_QUESTION_CODES.map((code) => ({
      ...question(
        code,
        withRules ? [createOfficialKioskApplicabilityRule()] : [],
      ),
      code,
    })),
  );
  version.dimensions[0].code = 'entorno_alimentario';
  return version;
}

function snapshot(
  overrides: Partial<SchoolRectificationSnapshot> = {},
): SchoolRectificationSnapshot {
  return {
    name: 'Escuela',
    cue: '500000001',
    directorName: 'Dirección',
    address: 'Calle 1',
    locality: 'Mendoza',
    scope: 'Urbano',
    educationLevel: 'Primario',
    shift: 'Simple',
    hasKiosk: true,
    hasFoodService: true,
    isBoarding: false,
    shiftCatalog: { code: 'simple', label: 'Simple' },
    educationLevels: [],
    enrollmentTotal: 0,
    ...overrides,
  };
}
