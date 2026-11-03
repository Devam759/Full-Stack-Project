import { v4 as uuidv4 } from 'uuid';

/**
 * Attaches a unique request ID to req.id and sets X-Request-Id header on response.
 */
export function requestIdMiddleware(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const requestId =
    typeof incomingId === 'string' && incomingId.trim() ? incomingId.trim() : uuidv4();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export default requestIdMiddleware;
