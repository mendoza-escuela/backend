import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export type AccountWelcomeEmailInput = {
  firstName: string;
  lastName: string;
  email: string;
  temporaryPassword: string;
};

type MailContent = {
  subject: string;
  text: string;
  html: string;
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character]!,
  );

/**
 * Construye el mensaje de alta sin almacenar ni registrar la contraseña
 * temporal. El HTML usa estilos inline para mantener compatibilidad con los
 * principales clientes de correo.
 */
export function buildAccountWelcomeEmail(
  account: AccountWelcomeEmailInput,
  frontendUrl: string,
): MailContent {
  const fullName = `${account.firstName} ${account.lastName}`.trim();
  const safeFullName = escapeHtml(fullName);
  const safeEmail = escapeHtml(account.email);
  const safeTemporaryPassword = escapeHtml(account.temporaryPassword);
  const safeFrontendUrl = escapeHtml(frontendUrl);
  const subject = 'Tu cuenta de acceso - Escuelas Promotoras de Salud';

  const text = [
    `Hola ${fullName},`,
    '',
    'Se creó tu cuenta en la plataforma Escuelas Promotoras de Salud.',
    '',
    `Usuario: ${account.email}`,
    `Contraseña temporal: ${account.temporaryPassword}`,
    `URL de acceso: ${frontendUrl}`,
    '',
    'Pasos para ingresar:',
    '1. Abrí la URL de acceso.',
    '2. Ingresá con tu correo y la contraseña temporal.',
    '3. Cuando el sistema lo solicite, creá una contraseña personal.',
    '4. En los próximos ingresos, usá tu nueva contraseña.',
    '',
    'Por seguridad, no compartas estas credenciales. La contraseña temporal dejará de ser válida cuando la cambies.',
    '',
    'Programa Escuelas Promotoras de Salud',
    'Gobierno de Mendoza',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
    <style>
      @media only screen and (max-width: 640px) {
        .email-shell { padding: 16px !important; }
        .email-card { border-radius: 16px !important; }
        .email-content { padding: 28px 22px !important; }
        .credential-label, .credential-value { display: block !important; width: 100% !important; }
        .credential-value { padding-top: 4px !important; text-align: left !important; }
        .button { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:#f7f4ef;color:#1f2937;font-family:REM,Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7f4ef;">
      <tr>
        <td class="email-shell" align="center" style="padding:36px 20px;">
          <table role="presentation" class="email-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;overflow:hidden;border:1px solid #e5e7eb;border-radius:20px;background:#ffffff;box-shadow:0 12px 32px rgba(31,41,55,0.08);">
            <tr>
              <td style="height:6px;background:#c8a977;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:24px 32px;background:#000f9f;color:#ffffff;">
                <p style="margin:0 0 5px;font-size:18px;font-weight:700;line-height:1.35;">Escuelas Promotoras de Salud</p>
                <p style="margin:0;color:#bfe9fa;font-size:13px;line-height:1.5;">Gobierno de Mendoza</p>
              </td>
            </tr>
            <tr>
              <td class="email-content" style="padding:36px 40px;">
                <p style="margin:0 0 10px;color:#000f9f;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Bienvenida/o a la plataforma</p>
                <h1 style="margin:0;color:#1f2937;font-size:28px;line-height:1.25;">Tu cuenta ya está disponible</h1>
                <p style="margin:18px 0 0;color:#4b5563;font-size:16px;line-height:1.65;">Hola ${safeFullName}, se creó tu cuenta institucional. Estos son los datos que necesitás para ingresar por primera vez.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:26px 0;border:1px solid #cdebf7;border-radius:14px;background:#f2fbfe;">
                  <tr>
                    <td colspan="2" style="padding:17px 20px 10px;color:#000f9f;font-size:14px;font-weight:700;">Datos de acceso</td>
                  </tr>
                  <tr>
                    <td class="credential-label" style="padding:10px 20px;color:#6b7280;font-size:14px;">Usuario</td>
                    <td class="credential-value" style="padding:10px 20px;text-align:right;color:#1f2937;font-size:14px;font-weight:700;word-break:break-word;">${safeEmail}</td>
                  </tr>
                  <tr>
                    <td class="credential-label" style="padding:10px 20px;color:#6b7280;font-size:14px;">Contraseña temporal</td>
                    <td class="credential-value" style="padding:10px 20px;text-align:right;color:#1f2937;font-family:Consolas,Monaco,monospace;font-size:14px;font-weight:700;word-break:break-all;">${safeTemporaryPassword}</td>
                  </tr>
                  <tr>
                    <td class="credential-label" style="padding:10px 20px 18px;color:#6b7280;font-size:14px;">URL</td>
                    <td class="credential-value" style="padding:10px 20px 18px;text-align:right;font-size:14px;font-weight:700;word-break:break-all;"><a href="${safeFrontendUrl}" style="color:#000f9f;text-decoration:none;">${safeFrontendUrl}</a></td>
                  </tr>
                </table>

                <a class="button" href="${safeFrontendUrl}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#000f9f;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Ingresar a la plataforma</a>

                <h2 style="margin:32px 0 14px;color:#1f2937;font-size:18px;line-height:1.4;">Cómo realizar el primer ingreso</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                  <tr><td valign="top" style="width:30px;padding:0 0 13px;"><span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#e4f5fc;color:#000f9f;font-size:13px;font-weight:700;line-height:24px;text-align:center;">1</span></td><td style="padding:1px 0 13px 10px;color:#4b5563;font-size:15px;line-height:1.5;">Abrí el enlace de acceso o usá el botón anterior.</td></tr>
                  <tr><td valign="top" style="width:30px;padding:0 0 13px;"><span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#e4f5fc;color:#000f9f;font-size:13px;font-weight:700;line-height:24px;text-align:center;">2</span></td><td style="padding:1px 0 13px 10px;color:#4b5563;font-size:15px;line-height:1.5;">Ingresá tu correo institucional y la contraseña temporal.</td></tr>
                  <tr><td valign="top" style="width:30px;padding:0 0 13px;"><span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#e4f5fc;color:#000f9f;font-size:13px;font-weight:700;line-height:24px;text-align:center;">3</span></td><td style="padding:1px 0 13px 10px;color:#4b5563;font-size:15px;line-height:1.5;">Creá una contraseña personal cuando el sistema te lo solicite.</td></tr>
                  <tr><td valign="top" style="width:30px;"><span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#e4f5fc;color:#000f9f;font-size:13px;font-weight:700;line-height:24px;text-align:center;">4</span></td><td style="padding:1px 0 0 10px;color:#4b5563;font-size:15px;line-height:1.5;">Usá esa nueva contraseña en los próximos ingresos.</td></tr>
                </table>

                <div style="margin-top:28px;padding:16px 18px;border-left:4px solid #c8a977;background:#fbf8f2;color:#4b5563;font-size:14px;line-height:1.55;">
                  <strong style="color:#1f2937;">Importante:</strong> no compartas estas credenciales. La contraseña temporal dejará de ser válida cuando la cambies.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #e5e7eb;background:#f8f9fa;color:#6b7280;font-size:12px;line-height:1.6;">Mensaje automático del Programa Escuelas Promotoras de Salud. No respondas a este correo.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Construye el mensaje de recuperación sin exponer el token fuera del enlace.
 * La estructura visual replica la comunicación de alta y conserva una versión
 * de texto plano para clientes de correo sin soporte HTML.
 */
export function buildPasswordResetEmail(
  resetUrl: string,
  expiresMinutes: number,
): MailContent {
  const safeResetUrl = escapeHtml(resetUrl);
  const subject = 'Restablecé tu contraseña - Escuelas Promotoras de Salud';
  const text = [
    'Hola,',
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta en Escuelas Promotoras de Salud.',
    '',
    `Creá una nueva contraseña desde este enlace: ${resetUrl}`,
    '',
    `El enlace vence en ${expiresMinutes} minutos y puede usarse una sola vez.`,
    'Si no solicitaste este cambio, ignorá este correo. Tu contraseña actual seguirá siendo válida.',
    '',
    'Programa Escuelas Promotoras de Salud',
    'Gobierno de Mendoza',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
    <style>
      @media only screen and (max-width: 640px) {
        .email-shell { padding: 16px !important; }
        .email-card { border-radius: 16px !important; }
        .email-content { padding: 28px 22px !important; }
        .button { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:#f7f4ef;color:#1f2937;font-family:REM,Inter,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7f4ef;">
      <tr>
        <td class="email-shell" align="center" style="padding:36px 20px;">
          <table role="presentation" class="email-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;overflow:hidden;border:1px solid #e5e7eb;border-radius:20px;background:#ffffff;box-shadow:0 12px 32px rgba(31,41,55,0.08);">
            <tr>
              <td style="height:6px;background:#c8a977;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:24px 32px;background:#000f9f;color:#ffffff;">
                <p style="margin:0 0 5px;font-size:18px;font-weight:700;line-height:1.35;">Escuelas Promotoras de Salud</p>
                <p style="margin:0;color:#bfe9fa;font-size:13px;line-height:1.5;">Gobierno de Mendoza</p>
              </td>
            </tr>
            <tr>
              <td class="email-content" style="padding:36px 40px;">
                <p style="margin:0 0 10px;color:#000f9f;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Seguridad de la cuenta</p>
                <h1 style="margin:0;color:#1f2937;font-size:28px;line-height:1.25;">Restablecé tu contraseña</h1>
                <p style="margin:18px 0 0;color:#4b5563;font-size:16px;line-height:1.65;">Recibimos una solicitud para cambiar la contraseña de tu cuenta. Usá el siguiente botón para crear una nueva.</p>

                <div style="margin:26px 0;padding:20px;border:1px solid #cdebf7;border-radius:14px;background:#f2fbfe;">
                  <p style="margin:0;color:#000f9f;font-size:14px;font-weight:700;">Enlace seguro y de un solo uso</p>
                  <p style="margin:8px 0 0;color:#4b5563;font-size:14px;line-height:1.55;">Por tu seguridad, estará disponible durante ${expiresMinutes} minutos. Después de usarlo o una vez vencido, deberás solicitar uno nuevo.</p>
                </div>

                <a class="button" href="${safeResetUrl}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#000f9f;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Crear nueva contraseña</a>

                <p style="margin:28px 0 8px;color:#6b7280;font-size:13px;line-height:1.55;">Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>
                <p style="margin:0;padding:12px 14px;border-radius:8px;background:#f8f9fa;color:#000f9f;font-size:12px;line-height:1.55;word-break:break-all;">${safeResetUrl}</p>

                <div style="margin-top:28px;padding:16px 18px;border-left:4px solid #c8a977;background:#fbf8f2;color:#4b5563;font-size:14px;line-height:1.55;">
                  <strong style="color:#1f2937;">Si no fuiste vos:</strong> ignorá este mensaje. Tu contraseña actual no se modificará y seguirá siendo válida.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #e5e7eb;background:#f8f9fa;color:#6b7280;font-size:12px;line-height:1.6;">Mensaje automático del Programa Escuelas Promotoras de Salud. No respondas a este correo.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

@Injectable()
export class MailService {
  private readonly transporter: Transporter | null;

  constructor(private readonly configService: ConfigService) {
    const host = configService.get<string>('SMTP_HOST');
    const user = configService.get<string>('SMTP_USER');
    const password = configService.get<string>('SMTP_PASSWORD');

    const port = Number(configService.get('SMTP_PORT') ?? 587);
    const useImplicitTls = port === 465;

    this.transporter =
      host && user && password
        ? nodemailer.createTransport({
            host,
            port,
            secure: useImplicitTls,
            // Fuera del 465 (TLS implícito) se exige STARTTLS. Sin esto,
            // nodemailer acepta continuar en texto plano cuando el servidor no
            // anuncia la extensión, exponiendo credenciales y contenido del
            // mensaje. ASVS 5.0 V9.1.1 (hallazgo H-05).
            requireTLS: !useImplicitTls,
            auth: { user, pass: password },
          })
        : null;
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendAccountWelcome(account: AccountWelcomeEmailInput): Promise<void> {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const content = buildAccountWelcomeEmail(account, frontendUrl);
    await this.send(account.email, content);
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const resetUrl = `${frontendUrl}/restablecer-clave?token=${encodeURIComponent(token)}`;
    const expiresMinutes = Number(
      this.configService.get('PASSWORD_RESET_TOKEN_EXPIRES_MINUTES') ?? 30,
    );

    await this.send(email, buildPasswordResetEmail(resetUrl, expiresMinutes));
  }

  private async send(email: string, content: MailContent): Promise<void> {
    if (!this.transporter) {
      throw new ServiceUnavailableException(
        'El servicio de correo todavía no está configurado.',
      );
    }

    await this.transporter.sendMail({
      from: this.configService.getOrThrow<string>('SMTP_FROM'),
      to: email,
      ...content,
    });
  }
}
