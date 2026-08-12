/**
 * Normaliza el origen autorizado para CORS y protección CSRF.
 *
 * No se aceptan rutas, credenciales, query strings ni fragmentos porque una
 * comparación de origen sólo contempla esquema, host y puerto.
 */
export function parseFrontendOrigin(value: string): string {
  const configuredOrigin = value.trim();
  let parsedOrigin: URL;

  try {
    parsedOrigin = new URL(configuredOrigin);
  } catch {
    throw new Error(`FRONTEND_URL contains an invalid origin: ${value}`);
  }

  if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
    throw new Error(`FRONTEND_URL origin must use HTTP or HTTPS: ${value}`);
  }

  if (
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== '/' ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new Error(
      `FRONTEND_URL must contain an origin without paths or credentials: ${value}`,
    );
  }

  return parsedOrigin.origin;
}
