import { Request, Response, NextFunction } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { logger } from '@/utils/logger';
import { config } from '@/config/environment';
import { ApiResponse, ErrorCode, HttpStatusCode } from '@/types/common';

export class AppError extends Error {
  statusCode: number;
  status: string;
  isOperational: boolean;
  code?: string;
  context?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    if (code !== undefined) this.code = code;
    if (context !== undefined) this.context = context;

    Error.captureStackTrace(this, this.constructor);
  }
}

interface ErrorDetails {
  message: string;
  statusCode: number;
  code?: string;
  suggestions?: string[];
}

// interface PrismaError extends Error {
//   code: string;
//   meta?: {
//     target?: string[];
//     field_name?: string;
//   };
// }

interface MongoError extends Error {
  code: number;
  keyPattern?: Record<string, number>;
}

// interface IValidationError extends Error {
//   errors: Record<string, { message: string }>;
// }

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = (req.headers['x-request-id'] as string) || 'unknown';
  const userId = (req as any).user?.id;

  // Log error with context
  logger.error('Error occurred', {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    request: {
      id: requestId,
      method: req.method,
      url: req.url,
      userId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    },
  });

  const errorDetails = processError(error);
  const sanitizedMessage = sanitizeErrorMessage(errorDetails.message, config.nodeEnv);

  const errorResponse: ApiResponse = {
    success: false,
    error: {
      message: sanitizedMessage,
      ...(errorDetails.code && { code: errorDetails.code }),
      statusCode: errorDetails.statusCode,
      timestamp: new Date().toISOString(),
      ...(errorDetails.suggestions && { suggestions: errorDetails.suggestions }),
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId,
    },
  };

  // Add stack trace in development
  if (config.nodeEnv === 'development' && error.stack) {
    errorResponse.error!.stack = error.stack;
  }

  res.status(errorDetails.statusCode).json(errorResponse);
};

function processError(error: Error): ErrorDetails {
  // Handle custom AppError
  if (error instanceof AppError) {
    return {
      message: error.message,
      statusCode: error.statusCode,
      ...(error.code && { code: error.code }),
    };
  }

  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as PrismaClientKnownRequestError;
    return handlePrismaError(prismaError);
  }

  // Handle Prisma validation errors
  if (error.name === 'PrismaClientValidationError') {
    return {
      message: 'Invalid data provided',
      statusCode: HttpStatusCode.BAD_REQUEST,
      code: ErrorCode.VALIDATION_ERROR,
      suggestions: ['Check the data format and required fields'],
    };
  }

  // Handle MongoDB/Mongoose errors (if using)
  if (error.name === 'MongoError') {
    const mongoError = error as MongoError;
    return handleMongoError(mongoError);
  }

  if (error.name === 'ValidationError') {
    const validationError = error as ValidationError;
    return handleValidationError(validationError);
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return {
      message: 'Invalid authentication token',
      statusCode: HttpStatusCode.UNAUTHORIZED,
      code: ErrorCode.AUTHENTICATION_ERROR,
      suggestions: ['Please log in again', 'Ensure the token is properly formatted'],
    };
  }

  if (error.name === 'TokenExpiredError') {
    return {
      message: 'Authentication token has expired',
      statusCode: HttpStatusCode.UNAUTHORIZED,
      code: ErrorCode.AUTHENTICATION_ERROR,
      suggestions: ['Please log in again to get a new token'],
    };
  }

  // Handle network errors
  if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
    return {
      message: 'External service temporarily unavailable',
      statusCode: HttpStatusCode.SERVICE_UNAVAILABLE,
      code: ErrorCode.EXTERNAL_API_ERROR,
      suggestions: ['Please try again later'],
    };
  }

  // Handle timeout errors
  if (error.message.includes('timeout')) {
    return {
      message: 'Request timeout',
      statusCode: HttpStatusCode.GATEWAY_TIMEOUT,
      code: ErrorCode.EXTERNAL_API_ERROR,
      suggestions: ['Please try again with a simpler request'],
    };
  }

  // Default error
  return {
    message: 'Internal server error',
    statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    suggestions: ['Please contact support if the problem persists'],
  };
}

function handlePrismaError(error: PrismaClientKnownRequestError): ErrorDetails {
  switch (error.code) {
    case 'P2002':
      const target = error.meta?.['target'] as string[] | undefined;
      const field = target?.[0] || 'field';
      return {
        message: `Duplicate value for ${field}`,
        statusCode: HttpStatusCode.CONFLICT,
        code: ErrorCode.CONFLICT,
        suggestions: [`The ${field} is already in use`, 'Please choose a different value'],
      };

    case 'P2025':
      return {
        message: 'Record not found',
        statusCode: HttpStatusCode.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
        suggestions: ['Check if the ID is correct', 'The record may have been deleted'],
      };

    case 'P2003':
      return {
        message: 'Foreign key constraint failed',
        statusCode: HttpStatusCode.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        suggestions: ['Check if the referenced record exists'],
      };

    case 'P2014':
      return {
        message: 'Invalid relation constraint',
        statusCode: HttpStatusCode.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        suggestions: ['Check the relationship between records'],
      };

    default:
      return {
        message: 'Database operation failed',
        statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
        code: ErrorCode.DATABASE_ERROR,
        suggestions: ['Please try again later'],
      };
  }
}

function handleMongoError(error: MongoError): ErrorDetails {
  if (error.code === 11000) {
    const keyPattern = error.keyPattern;
    const field = keyPattern ? Object.keys(keyPattern)[0] : 'field';
    return {
      message: `Duplicate value for ${field}`,
      statusCode: HttpStatusCode.CONFLICT,
      code: ErrorCode.CONFLICT,
      suggestions: [`The ${field} is already in use`, 'Please choose a different value'],
    };
  }

  return {
    message: 'Database operation failed',
    statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
    code: ErrorCode.DATABASE_ERROR,
    suggestions: ['Please try again later'],
  };
}

function handleValidationError(error: ValidationError): ErrorDetails {
  const context = error.context as { errors?: Array<{ message: string }> } | undefined;
  const messages = context?.errors?.map((err) => err.message).join(', ') || error.message;

  return {
    message: `Validation failed: ${messages}`,
    statusCode: HttpStatusCode.BAD_REQUEST,
    code: ErrorCode.VALIDATION_ERROR,
    suggestions: ['Check the required fields and their formats'],
  };
}

function sanitizeErrorMessage(message: string, nodeEnv: string): string {
  // In production, sanitize sensitive information
  if (nodeEnv === 'production') {
    // Remove potential sensitive information
    return message
      .replace(/password/gi, '***')
      .replace(/token/gi, '***')
      .replace(/key/gi, '***')
      .replace(/secret/gi, '***')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '***@***.***'); // Email
  }

  return message;
}

// Async error handler wrapper
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): Promise<void> => {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Custom error classes
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, HttpStatusCode.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, HttpStatusCode.UNAUTHORIZED, ErrorCode.AUTHENTICATION_ERROR);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, HttpStatusCode.FORBIDDEN, ErrorCode.AUTHORIZATION_ERROR);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, HttpStatusCode.NOT_FOUND, ErrorCode.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, HttpStatusCode.CONFLICT, ErrorCode.CONFLICT, context);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, HttpStatusCode.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMIT_EXCEEDED);
  }
}

export class ExternalApiError extends AppError {
  constructor(service: string, message?: string) {
    super(
      message || `External service ${service} is temporarily unavailable`,
      HttpStatusCode.BAD_GATEWAY,
      ErrorCode.EXTERNAL_API_ERROR
    );
  }
}
