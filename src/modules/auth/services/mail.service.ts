import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly transporter: Transporter | null;

  constructor(private readonly configService: ConfigService) {
    const host = configService.get<string>('SMTP_HOST');
    const user = configService.get<string>('SMTP_USER');
    const password = configService.get<string>('SMTP_PASSWORD');

    this.transporter =
      host && user && password
        ? nodemailer.createTransport({
            host,
            port: Number(configService.get('SMTP_PORT') ?? 587),
            secure: Number(configService.get('SMTP_PORT') ?? 587) === 465,
            auth: { user, pass: password },
          })
        : null;
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    if (!this.transporter) {
      throw new ServiceUnavailableException(
        'El servicio de correo todavía no está configurado.',
      );
    }

    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const resetUrl = `${frontendUrl}/restablecer-clave?token=${encodeURIComponent(token)}`;

    await this.transporter.sendMail({
      from: this.configService.getOrThrow<string>('SMTP_FROM'),
      to: email,
      subject: 'Recuperación de contraseña - Escuelas Promotoras de Salud',
      text: `Para restablecer tu contraseña ingresá en: ${resetUrl}\n\nEl enlace vence y puede usarse una sola vez.`,
      html: `<p>Solicitaste restablecer tu contraseña.</p><p><a href="${resetUrl}">Restablecer contraseña</a></p><p>El enlace vence y puede usarse una sola vez.</p>`,
    });
  }
}
