import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ReportBrandingProvider } from './report-branding.provider';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const mockedExistsSync = jest.mocked(existsSync);
const mockedReadFileSync = jest.mocked(readFileSync);
const config = (values: Record<string, string> = {}) =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

describe('ReportBrandingProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(Buffer.from('brand-image'));
  });

  it('uses the bundled Mendoza and OMS/OPS assets when overrides are absent', () => {
    const provider = new ReportBrandingProvider(config());

    const branding = provider.get();

    expect(mockedExistsSync).toHaveBeenNthCalledWith(
      1,
      resolve(
        __dirname,
        '../../../../assets/brand/official/mendoza/marca-gobierno-mendoza.png',
      ),
    );
    expect(mockedExistsSync).toHaveBeenNthCalledWith(
      2,
      resolve(__dirname, '../../../../assets/brand/official/ops/oms-ops.jpg'),
    );
    expect(branding.logos).toEqual([
      `data:image/png;base64,${Buffer.from('brand-image').toString('base64')}`,
      `data:image/jpeg;base64,${Buffer.from('brand-image').toString('base64')}`,
    ]);
  });

  it('prefers configured paths and preserves optional Health and DGE logos', () => {
    const provider = new ReportBrandingProvider(
      config({
        REPORT_LOGO_MENDOZA_PATH: ' /branding/mendoza.png ',
        REPORT_LOGO_HEALTH_PATH: '/branding/salud.jpg',
        REPORT_LOGO_DGE_PATH: '/branding/dge.jpeg',
        REPORT_LOGO_OPS_PATH: '/branding/ops.png',
      }),
    );

    const branding = provider.get();

    expect(mockedExistsSync.mock.calls.map(([path]) => path)).toEqual([
      '/branding/mendoza.png',
      '/branding/salud.jpg',
      '/branding/dge.jpeg',
      '/branding/ops.png',
    ]);
    expect(branding.logos).toHaveLength(4);
  });

  it('keeps the textual fallback when an image is missing or unsupported', () => {
    mockedExistsSync.mockImplementation((path) =>
      String(path).endsWith('marca-gobierno-mendoza.png'),
    );
    const provider = new ReportBrandingProvider(
      config({
        REPORT_PROGRAM_NAME: 'Programa de prueba',
        REPORT_ORGANIZATIONS: 'Organismos de prueba',
        REPORT_LOGO_OPS_PATH: '/branding/ops.svg',
      }),
    );

    const branding = provider.get();

    expect(branding.programName).toBe('Programa de prueba');
    expect(branding.organizations).toBe('Organismos de prueba');
    expect(branding.logos).toHaveLength(1);
  });
});
