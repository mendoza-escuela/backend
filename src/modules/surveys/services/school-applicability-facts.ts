import { SchoolRectificationSnapshot } from '../../schools/entities/school-rectification.entity';
import { SchoolApplicabilityFacts } from './applicability-engine.service';

/**
 * Convierte exclusivamente campos conocidos del snapshot rectificado en hechos
 * consumibles por el motor. `false` y `0` son valores informados; `null`
 * representa información ausente y nunca se interpreta como falso.
 */
export function schoolApplicabilityFactsFromSnapshot(
  snapshot: SchoolRectificationSnapshot | null,
): SchoolApplicabilityFacts {
  return {
    has_kiosk:
      snapshot?.hasKiosk === true || snapshot?.hasKiosk === false
        ? snapshot.hasKiosk
        : null,
    has_food_service:
      snapshot?.hasFoodService === true || snapshot?.hasFoodService === false
        ? snapshot.hasFoodService
        : null,
    is_boarding:
      snapshot?.isBoarding === true || snapshot?.isBoarding === false
        ? snapshot.isBoarding
        : null,
    shift: snapshot?.shiftCatalog?.code ?? null,
    education_levels: Array.isArray(snapshot?.educationLevels)
      ? snapshot.educationLevels.map(({ code }) => code)
      : null,
    enrollment_total:
      snapshot?.enrollmentTotal === 0 || snapshot?.enrollmentTotal
        ? snapshot.enrollmentTotal
        : null,
  };
}
