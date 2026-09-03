import type { ErrorRequestHandler, Request } from 'express';

import { AppError, ErrorCode } from '../shared/errors/index.js';

/**
 * Standard API error response.
 */
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Global Express error middleware.
 *
 * All errors thrown from routes/controllers/services
 * eventually come here.
 */
export const errorMiddleware: ErrorRequestHandler = (error, req: Request, res, _next) => {
  /**
   * Handle errors intentionally created by our application.
   */
  if (error instanceof AppError) {
    const response: ErrorResponse = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };

    /**
     * Only expose details when they exist.
     */
    if (error.details !== undefined) {
      response.error.details = error.details;
    }

    return res.status(error.statusCode).json(response);
  }

  /**
   * Unexpected/unhandled errors.
   *
   * We don't expose the original error to the client
   * because it may contain internal implementation details.
   */
  console.error(`[ERROR] ${req.method} ${req.originalUrl}`, error);

  const response: ErrorResponse = {
    success: false,
    error: {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred.',
    },
  };

  return res.status(500).json(response);
};
