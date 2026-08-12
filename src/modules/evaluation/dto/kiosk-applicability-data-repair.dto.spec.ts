import 'reflect-metadata';
import { validate } from 'class-validator';
import { KioskApplicabilityDataRepairPreviewDto } from './kiosk-applicability-data-repair.dto';

describe('KioskApplicabilityDataRepairPreviewDto', () => {
  const submissionId = '11111111-1111-4111-8111-111111111111';

  it('accepts a unique selection of at most 500 submissions', async () => {
    const dto = Object.assign(new KioskApplicabilityDataRepairPreviewDto(), {
      submissionIds: [submissionId],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects duplicate submissions', async () => {
    const dto = Object.assign(new KioskApplicabilityDataRepairPreviewDto(), {
      submissionIds: [submissionId, submissionId],
    });

    expect((await validate(dto)).map(({ property }) => property)).toContain(
      'submissionIds',
    );
  });

  it('rejects batches larger than 500 submissions', async () => {
    const dto = Object.assign(new KioskApplicabilityDataRepairPreviewDto(), {
      submissionIds: Array.from(
        { length: 501 },
        (_, index) =>
          `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      ),
    });

    expect((await validate(dto)).map(({ property }) => property)).toContain(
      'submissionIds',
    );
  });
});
