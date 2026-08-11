import {
  buildAccountWelcomeEmail,
  buildPasswordResetEmail,
} from './mail.service';

describe('buildAccountWelcomeEmail', () => {
  it('incluye credenciales temporales, URL y pasos en ambas versiones', () => {
    const content = buildAccountWelcomeEmail(
      {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@mendoza.gov.ar',
        temporaryPassword: 'Temporal!Clave2026',
      },
      'https://escuelas.mendoza.gov.ar',
    );

    expect(content.subject).toContain('Tu cuenta de acceso');
    expect(content.text).toContain('Usuario: ana@mendoza.gov.ar');
    expect(content.text).toContain('Contraseña temporal: Temporal!Clave2026');
    expect(content.text).toContain('https://escuelas.mendoza.gov.ar');
    expect(content.text).toContain('Pasos para ingresar:');
    expect(content.html).toContain('Datos de acceso');
    expect(content.html).toContain('Cómo realizar el primer ingreso');
    expect(content.html).toContain('Ingresar a la plataforma');
  });

  it('escapa los valores dinámicos antes de incorporarlos al HTML', () => {
    const content = buildAccountWelcomeEmail(
      {
        firstName: '<script>alert(1)</script>',
        lastName: 'Pérez & Asociados',
        email: 'ana+alta@example.com',
        temporaryPassword: 'Clave<temporal>&"',
      },
      'https://escuelas.mendoza.gov.ar',
    );

    expect(content.html).not.toContain('<script>alert(1)</script>');
    expect(content.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(content.html).toContain('Pérez &amp; Asociados');
    expect(content.html).toContain('Clave&lt;temporal&gt;&amp;&quot;');
  });
});

describe('buildPasswordResetEmail', () => {
  it('incluye la acción, la vigencia y las advertencias de seguridad', () => {
    const resetUrl =
      'https://escuelas.mendoza.gov.ar/restablecer-clave?token=token-seguro';
    const content = buildPasswordResetEmail(resetUrl, 30);

    expect(content.subject).toContain('Restablecé tu contraseña');
    expect(content.text).toContain(resetUrl);
    expect(content.text).toContain('vence en 30 minutos');
    expect(content.text).toContain('puede usarse una sola vez');
    expect(content.html).toContain('Crear nueva contraseña');
    expect(content.html).toContain('Gobierno de Mendoza');
    expect(content.html).toContain('Si no fuiste vos');
  });

  it('escapa el enlace antes de incorporarlo al HTML', () => {
    const content = buildPasswordResetEmail(
      'https://escuelas.mendoza.gov.ar/restablecer-clave?token=<token>&next="login"',
      30,
    );

    expect(content.html).not.toContain('token=<token>');
    expect(content.html).toContain(
      'token=&lt;token&gt;&amp;next=&quot;login&quot;',
    );
  });
});
