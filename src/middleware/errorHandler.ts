import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { config } from '@/config/environment';

export class AppError extends Error {
  statusCode: number;
  status: string;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
export const errorHandler = (error: Error, _req: Request, res: Response, _next: NextFunction) => {
  let err = { ...error };
  err.message = error.message;

  // Log error
  logger.error(error);

  // Mongoose bad ObjectId
  if (error.name === 'CastError') {
    const message = 'Resource not found';
    err = new AppError(message, 404);
  }

  // Mongoose duplicate key
  if (error.name === 'MongoError' && (error as any).code === 11000) {
    const message = 'Duplicate field value entered';
    err = new AppError(message, 400);
  }

  // Mongoose validation error
  if (error.name === 'ValidationError') {
    const message = Object.values((error as any).errors)
      .map((val: any) => val.message)
      .join(', ');
    err = new AppError(message, 400);
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    const message = 'Invalid token. Please log in again!';
    err = new AppError(message, 401);
  }

  if (error.name === 'TokenExpiredError') {
    const message = 'Your token has expired! Please log in again.';
    err = new AppError(message, 401);
  }

  // Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;
    if (prismaError.code === 'P2002') {
      const message = 'Duplicate field value entered';
      err = new AppError(message, 400);
    }
    if (prismaError.code === 'P2025') {
      const message = 'Record not found';
      err = new AppError(message, 404);
    }
  }

  const statusCode = (err as AppError).statusCode || 500;
  const errorResponse: any = {
    success: false,
    error: {
      message: (err as AppError).message || 'Server Error',
      statusCode,
      timestamp: new Date().toISOString(),
    },
  };

  // Add helpful suggestions for 404 errors
  if (statusCode === 404) {
    errorResponse.error.suggestions = [
      'Check the URL for typos',
      'Verify the HTTP method (GET, POST, PUT, DELETE)',
      'Visit /api for available endpoints',
      'Ensure you are using the correct API version (v1)',
    ];
  }

  // Add development information
  if (config.nodeEnv === 'development') {
    errorResponse.error.stack = error.stack;
  }

  res.status(statusCode).json(errorResponse);
};
