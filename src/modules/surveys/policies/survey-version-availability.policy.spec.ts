import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { isHistoricallyAvailableSurveyVersion } from './survey-version-availability.policy';

describe('isHistoricallyAvailableSurveyVersion', () => {
  const publishedAt = new Date('2026-01-01T00:00:00Z');

  it.each([SurveyVersionStatus.Published, SurveyVersionStatus.Archived])(
    'mantiene disponible históricamente una versión %s publicada alguna vez',
    (status) => {
      expect(isHistoricallyAvailableSurveyVersion(status, publishedAt)).toBe(
        true,
      );
    },
  );

  it('rechaza borradores y versiones sin fecha de publicación', () => {
    expect(
      isHistoricallyAvailableSurveyVersion(
        SurveyVersionStatus.Draft,
        publishedAt,
      ),
    ).toBe(false);
    expect(
      isHistoricallyAvailableSurveyVersion(SurveyVersionStatus.Archived, null),
    ).toBe(false);
  });
});
