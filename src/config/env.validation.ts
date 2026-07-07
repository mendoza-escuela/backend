type Environment = Record<string, string | undefined>;

const requiredAppEnvironmentVariables = [
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
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

  if (config.DATABASE_URL) {
    return config;
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

  return {
    ...config,
    DATABASE_PORT: databasePort,
  };
}
