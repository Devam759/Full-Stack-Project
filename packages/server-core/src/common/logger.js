import pino from 'pino';

export const REDACTED_PATHS = [
  'password',
  '*.password',
  '*.*.password',
  'passwordHash',
  '*.passwordHash',
  '*.*.passwordHash',
  'token',
  '*.token',
  '*.*.token',
  'accessToken',
  '*.accessToken',
  '*.*.accessToken',
  'refreshToken',
  '*.refreshToken',
  '*.*.refreshToken',
  'email',
  '*.email',
  '*.*.email',
  'req.headers.authorization',
  'req.headers.cookie',
  'coordinates',
  '*.coordinates',
  '*.*.coordinates',
  'location.coordinates',
  'approxLocation.coordinates',
  'lat',
  'lng',
  '*.lat',
  '*.lng',
];

export function createLogger(options = {}, destination) {
  const isTest = process.env.NODE_ENV === 'test';
  const { stream, ...pinoOptions } = options;
  const dest = destination || stream;

  return pino(
    {
      level: options.level || (isTest ? 'silent' : process.env.LOG_LEVEL || 'info'),
      redact: {
        paths: REDACTED_PATHS,
        censor: '[REDACTED]',
      },
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...pinoOptions,
    },
    dest,
  );
}

export const logger = createLogger();
export default logger;
