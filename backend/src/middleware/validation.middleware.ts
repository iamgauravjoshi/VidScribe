import type { NextFunction, Request, Response } from 'express';

import { AppError, ErrorCode } from '../shared/errors/index.js';

export type RequestValidator = (req: Request) => Record<string, string>;

/**
 * Creates Express middleware from a request validator.
 *
 * The validator returns an object containing validation errors.
 * An empty object means the request is valid.
 */
export function validate(validator: RequestValidator) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors = validator(req);

    if (Object.keys(errors).length > 0) {
      next(new AppError('Request validation failed.', ErrorCode.VALIDATION_ERROR, 400, errors));

      return;
    }

    next();
  };
}
