import { Readable } from 'node:stream';
import { AdminUsersService } from '../services/admin-users.service';
import { BulkUserImportService } from '../services/bulk-user-import.service';
import { AdminUsersController } from './admin-users.controller';

describe('Plantilla de usuarios', () => {
  it('entrega bytes CSV con MIME, nombre y BOM', async () => {
    const buffer = Buffer.from('\uFEFFcorreo,nombre\r\nana@example.com,Ana');
    const controller = new AdminUsersController(
      {} as AdminUsersService,
      { template: jest.fn(() => buffer) } as unknown as BulkUserImportService,
    );

    const file = controller.template();
    const downloaded = await streamBuffer(file.getStream());

    expect(file.getHeaders()).toMatchObject({
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="plantilla-usuarios.csv"',
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
