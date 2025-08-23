import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { logger } from '@/utils/logger';

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  // Log the 404 for monitoring purposes
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });

  // Create more descriptive error messages based on the route
  let message = `Route not found: ${req.method} ${req.originalUrl}`;

  if (req.originalUrl.startsWith('/api/')) {
    message = `API endpoint not found: ${req.method} ${req.originalUrl}. Please check the API documentation for available routes.`;
  }

  const error = new AppError(message, 404);
  next(error);
};
