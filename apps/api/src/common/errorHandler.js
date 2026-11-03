import { AppError, ERROR_CODES, formatErrorResponse } from '@borrowloop/shared';
import logger from './logger.js';

/**
 * Global Express error handling middleware.
 */
export function errorHandler(err, req, res, _next) {
  // If headers were already sent, delegate to default express error handler
  if (res.headersSent) {
    return _next(err);
  }

  // Handle our known AppError
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Handle body-parser entity too large (payload limit)
  if (err.type === 'entity.too.large') {
    return res
      .status(413)
      .json(
        formatErrorResponse(
          ERROR_CODES.BAD_REQUEST,
          'Request payload exceeds the allowed size limit of 1MB',
          { limit: '1MB' },
        ),
      );
  }

  // Handle malformed JSON body parse errors
  if (err instanceof SyntaxError && 'body' in err) {
    return res
      .status(400)
      .json(formatErrorResponse(ERROR_CODES.BAD_REQUEST, 'Malformed JSON body'));
  }

  // Handle unexpected internal server errors
  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        name: err.name,
      },
      requestId: req.id,
      path: req.originalUrl,
      method: req.method,
    },
    'Unhandled server error occurred',
  );

  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction ? 'An unexpected internal error occurred' : err.message;
  const details = isProduction ? {} : { stack: err.stack };

  return res.status(500).json(formatErrorResponse(ERROR_CODES.INTERNAL_ERROR, message, details));
}

export default errorHandler;
