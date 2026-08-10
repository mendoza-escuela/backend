import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { ReportBranding } from '../report.types';

@Injectable()
export class ReportBrandingProvider {
  constructor(private readonly config: ConfigService) {}

  get(): ReportBranding {
    const logoPaths = [
      this.config.get<string>('REPORT_LOGO_MENDOZA_PATH'),
      this.config.get<string>('REPORT_LOGO_HEALTH_PATH'),
      this.config.get<string>('REPORT_LOGO_DGE_PATH'),
      this.config.get<string>('REPORT_LOGO_OPS_PATH'),
    ].filter((value): value is string => Boolean(value));
    return {
      programName:
        this.config.get<string>('REPORT_PROGRAM_NAME') ||
        'Escuelas Promotoras de Salud',
      organizations:
        this.config.get<string>('REPORT_ORGANIZATIONS') ||
        'Gobierno de Mendoza',
      logos: logoPaths.flatMap((path) => {
        const image = this.image(path);
        return image ? [image] : [];
      }),
      signer: this.nullable('REPORT_SIGNER_NAME'),
      signerPosition: this.nullable('REPORT_SIGNER_POSITION'),
      signatureImage: this.image(
        this.config.get<string>('REPORT_SIGNATURE_PATH'),
      ),
      legalText: this.nullable('REPORT_LEGAL_TEXT'),
      verificationUrl: this.nullable('REPORT_VERIFICATION_URL'),
    };
  }

  private nullable(key: string) {
    return this.config.get<string>(key)?.trim() || null;
  }

  private image(path: string | undefined) {
    if (!path || !existsSync(path)) return null;
    const mime =
      extname(path).toLowerCase() === '.png'
        ? 'image/png'
        : extname(path).toLowerCase() === '.jpg' ||
            extname(path).toLowerCase() === '.jpeg'
          ? 'image/jpeg'
          : null;
    if (!mime) return null;
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  }
}
