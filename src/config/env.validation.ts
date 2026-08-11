import { parseFrontendOrigin } from './frontend-origins';

type Environment = Record<string, string | number | undefined>;

const requiredAppEnvironmentVariables = [
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'FRONTEND_URL',
] as const;

const requiredDatabaseEnvironmentVariables = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
] as const;

export function validateEnvironment(config: Environment) {
  const missingAppVariables = requiredAppEnvironmentVariables.filter(
    (variableName) => !config[variableName],
  );

  if (missingAppVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingAppVariables.join(', ')}`,
    );
  }

  parseFrontendOrigin(String(config.FRONTEND_URL));

  if (config.DATABASE_URL) {
    return validateNumericEnvironment(config);
  }

  const missingDatabaseVariables = requiredDatabaseEnvironmentVariables.filter(
    (variableName) => !config[variableName],
  );

  if (missingDatabaseVariables.length > 0) {
    throw new Error(
      `Missing DATABASE_URL or required database variables: ${missingDatabaseVariables.join(', ')}`,
    );
  }

  const databasePort = Number(config.DATABASE_PORT);

  if (!Number.isInteger(databasePort) || databasePort <= 0) {
    throw new Error('DATABASE_PORT must be a positive integer.');
  }

  return validateNumericEnvironment({
    ...config,
    DATABASE_PORT: databasePort,
  });
}

function validateNumericEnvironment(config: Environment) {
  for (const variableName of [
    'SESSION_DURATION_HOURS',
    'LOGIN_MAX_ATTEMPTS',
    'LOGIN_LOCK_MINUTES',
    'PASSWORD_RESET_TOKEN_EXPIRES_MINUTES',
    'TRUST_PROXY_HOPS',
  ]) {
    const value = Number(config[variableName]);
    const allowsZero = variableName === 'TRUST_PROXY_HOPS';
    if (
      config[variableName] !== undefined &&
      config[variableName] !== '' &&
      (!Number.isInteger(value) || (allowsZero ? value < 0 : value <= 0))
    ) {
      throw new Error(
        `${variableName} must be ${allowsZero ? 'a non-negative' : 'a positive'} integer.`,
      );
    }
  }

  const smtpValues = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM',
  ];
  const configuredSmtpValues = smtpValues.filter((name) => config[name]);
  if (
    configuredSmtpValues.length > 0 &&
    configuredSmtpValues.length !== smtpValues.length
  ) {
    throw new Error('SMTP configuration must be complete or entirely empty.');
  }
  return config;
}
