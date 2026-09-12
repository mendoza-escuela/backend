import { sanitizeAuditChanges } from './audit-sanitizer';

describe('audit minimization', () => {
  it('elimina secretos y datos personales anidados sin perder cambios de privilegios', () => {
    const safe = sanitizeAuditChanges({
      role: { from: 'school', to: 'admin' },
      email: 'private@example.com',
      nested: {
        passwordHash: 'hash',
        accessToken: 'jwt',
        authorization: 'Bearer secret',
        SMTP_PASSWORD: 'smtp',
      },
      comment: 'Bearer arbitrary-secret',
      session: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
    });
    expect(safe).toMatchObject({
      role: { from: 'school', to: 'admin' },
      email: '[redacted]',
      comment: '[redacted]',
      session: '[redacted]',
    });
    expect(JSON.stringify(safe)).not.toContain('private@example.com');
    expect(JSON.stringify(safe)).not.toContain('arbitrary-secret');
  });
  it('limita texto, estructuras y caracteres de control', () => {
    expect(sanitizeAuditChanges('hello\r\nworld')).toBe('hello  world');
    expect((sanitizeAuditChanges('x'.repeat(1000)) as string).length).toBe(500);
    expect((sanitizeAuditChanges(Array(100).fill(1)) as unknown[]).length).toBe(
      50,
    );
  });
});
