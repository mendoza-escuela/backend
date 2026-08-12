import { AdminEvaluationDataQualityController } from './admin-evaluation-data-quality.controller';
import { KioskApplicabilityDataRepairService } from '../services/kiosk-applicability-data-repair.service';

describe('AdminEvaluationDataQualityController', () => {
  it('delegates the selected batch to the scoped preview', async () => {
    const preview = jest.fn().mockResolvedValue({
      affectedSubmissionCount: 1,
      repairable: true,
      fingerprint: 'a'.repeat(64),
    });
    const controller = new AdminEvaluationDataQualityController({
      preview,
    } as unknown as KioskApplicabilityDataRepairService);
    const submissionIds = ['11111111-1111-4111-8111-111111111111'];

    await expect(controller.preview({ submissionIds })).resolves.toMatchObject({
      affectedSubmissionCount: 1,
      repairable: true,
    });
    expect(preview).toHaveBeenCalledWith(submissionIds);
  });
});
