import { ERROR_CODES, formatErrorResponse } from '@borrowloop/shared';

/**
 * Express middleware to validate request body, query, params, or headers using Zod schemas.
 *
 * @param {object} schemas
 * @param {import('zod').ZodSchema} [schemas.body]
 * @param {import('zod').ZodSchema} [schemas.query]
 * @param {import('zod').ZodSchema} [schemas.params]
 * @param {import('zod').ZodSchema} [schemas.headers]
 */
export function validate(schemas = {}) {
  return (req, res, next) => {
    const details = {};

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        details.body = result.error.flatten().fieldErrors;
      } else {
        req.body = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        details.query = result.error.flatten().fieldErrors;
      } else {
        req.query = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        details.params = result.error.flatten().fieldErrors;
      } else {
        req.params = result.data;
      }
    }

    if (schemas.headers) {
      const result = schemas.headers.safeParse(req.headers);
      if (!result.success) {
        details.headers = result.error.flatten().fieldErrors;
      }
    }

    if (Object.keys(details).length > 0) {
      return res
        .status(400)
        .json(
          formatErrorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            'Validation failed for request parameters',
            details,
          ),
        );
    }

    next();
  };
}

export default validate;
