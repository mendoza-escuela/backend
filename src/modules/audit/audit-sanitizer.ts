const privateKey =
  /password|passwd|secret|token|authorization|cookie|credential|email|firstname|lastname|fullname|phone|address|body|stack|query|parameters|privatekey|apikey|^key$|sessionid/i;

/** Minimiza datos personales y elimina secretos también en objetos anidados. */
export function sanitizeAuditChanges(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[omitted]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number')
    return value;
  if (typeof value === 'string') {
    // Defensa adicional ante credenciales pegadas en un campo de texto libre.
    if (
      /Bearer\s|eyJ[\w-]+\.[\w-]+\.|:\/\/[^\s/]+@|(?:password|secret|token)\s*[:=]/i.test(
        value,
      )
    )
      return '[redacted]';
    return [...value.slice(0, 500)]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? ' ' : character;
      })
      .join('');
  }
  if (Array.isArray(value))
    return value
      .slice(0, 50)
      .map((entry) => sanitizeAuditChanges(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, entry]) => [
          key.slice(0, 80),
          privateKey.test(key)
            ? '[redacted]'
            : sanitizeAuditChanges(entry, depth + 1),
        ]),
    );
  }
  return null;
}
