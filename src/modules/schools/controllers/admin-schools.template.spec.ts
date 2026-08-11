import { Readable } from 'node:stream';
import { BulkSchoolImportService } from '../services/bulk-school-import.service';
import { SchoolsService } from '../services/schools.service';
import { AdminSchoolsController } from './admin-schools.controller';

describe('Plantilla de colegios', () => {
  it('entrega bytes CSV con MIME, nombre y BOM', async () => {
    const buffer = Buffer.from('\uFEFFcue,nombre\r\n123,Escuela');
    const controller = new AdminSchoolsController(
      {} as SchoolsService,
      { template: jest.fn(() => buffer) } as unknown as BulkSchoolImportService,
    );

    const file = controller.template();
    const downloaded = await streamBuffer(file.getStream());

    expect(file.getHeaders()).toMatchObject({
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="plantilla-colegios.csv"',
      length: buffer.length,
    });
    expect(downloaded.subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(downloaded).toEqual(buffer);
  });
});

async function streamBuffer(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    const bytes = chunk as Uint8Array;
    chunks.push(Buffer.from(bytes));
  }
  return Buffer.concat(chunks);
}
