import { SurveyVersionStatus } from '../entities/survey-version-status.enum';

/**
 * Indica si una versión publicada alguna vez conserva validez histórica.
 *
 * Las versiones archivadas son inmutables y siguen respaldando etapas y
 * presentaciones existentes, pero no se ofrecen al crear etapas nuevas.
 */
export function isHistoricallyAvailableSurveyVersion(
  status: SurveyVersionStatus,
  publishedAt: Date | null,
) {
  return (
    !!publishedAt &&
    [SurveyVersionStatus.Published, SurveyVersionStatus.Archived].includes(
      status,
    )
  );
}
