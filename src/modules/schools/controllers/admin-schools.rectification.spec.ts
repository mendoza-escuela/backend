import { AdminRectifySchoolDto } from '../dto/admin-rectify-school.dto';
import { BulkSchoolImportService } from '../services/bulk-school-import.service';
import { SchoolsService } from '../services/schools.service';
import { AdminSchoolsController } from './admin-schools.controller';

describe('AdminSchoolsController rectification', () => {
  it('delega el contrato administrativo al cierre atómico del servicio', async () => {
    const dto = { schoolNumber: '1-001' } as AdminRectifySchoolDto;
    const actor = { id: 'actor-id' };
    const rectifyAsAdmin = jest.fn().mockResolvedValue({ id: 'school-id' });
    const controller = new AdminSchoolsController(
      { rectifyAsAdmin } as unknown as SchoolsService,
      {} as BulkSchoolImportService,
    );

    await expect(
      controller.rectify('school-id', dto, { user: actor } as never),
    ).resolves.toEqual({ id: 'school-id' });
    expect(rectifyAsAdmin).toHaveBeenCalledWith('school-id', dto, actor);
  });
});
