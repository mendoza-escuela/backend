import { OFFICIAL_KIOSK_QUESTION_CODES } from './official-survey-applicability.policy';

describe('historical kiosk applicability repair scope', () => {
  it('keeps the approved historical question set isolated from survey validation', () => {
    expect(OFFICIAL_KIOSK_QUESTION_CODES).toEqual([
      'p021',
      'p022',
      'p023',
      'p024',
      'p025',
      'p026',
      'p027',
    ]);
  });
});
