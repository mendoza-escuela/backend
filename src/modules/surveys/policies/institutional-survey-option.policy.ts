function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Identifica alternativas autónomas de tipo “Otro” o “No aplica”.
 *
 * No rechaza frases válidas que sólo contienen esas palabras, como
 * “u otro enfoque de promoción de la salud”.
 */
export function isForbiddenInstitutionalSurveyOption(
  code: string,
  label: string,
) {
  const normalizedCode = normalize(code);
  const normalizedLabel = normalize(label)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return (
    /(^|_)(otro|otra|otros|otras|other)(_|$)/.test(normalizedCode) ||
    /^(otro|otra|otros|otras|other)(\b|$)/.test(normalizedLabel) ||
    /(^|_)(no_(aplica|corresponde)|not_applicable)(_|$)/.test(normalizedCode) ||
    /^(no (aplica|corresponde)|not applicable)(\b|$)/.test(normalizedLabel)
  );
}
