// The important thing is that the service doesn't need to know how the error is eventually serialized into an HTTP response.

import { ErrorCode } from './error-codes.js';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode = 500,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);

    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;

    /**
     * Required when extending built-in Error classes
     * in some JavaScript/TypeScript environments.
     */
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
