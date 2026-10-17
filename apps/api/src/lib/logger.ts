import winston from 'winston';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} ${level}: ${stack || message}${rest}`;
});

const isProd = process.env.NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: combine(errors({ stack: true }), timestamp()),
  transports: [
    new winston.transports.Console({
      format: isProd ? json() : combine(colorize(), devFormat),
    }),
  ],
});

export default logger;
