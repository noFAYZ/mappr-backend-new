import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { getCacheService } from '@/services/CacheService';
import { logger } from '@/utils/logger';
import { RateLimitError, ValidationError } from '@/middleware/errorHandler';
import { ApiResponse } from '@/types/common';

// IP-based rate limiting with Redis backend
const createAdvancedRateLimit = (options: {
  windowMs: number;
  max: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  onLimitReached?: (req: Request) => void;
}) => {
  const cacheService = getCacheService();

  // Use Redis-based rate limiter if available, otherwise fallback to memory
  if (cacheService) {
    const rateLimiter = new RateLimiterRedis({
      storeClient: (cacheService as any).redis,
      points: options.max,
      duration: Math.floor(options.windowMs / 1000),
      blockDuration: Math.floor(options.windowMs / 1000),
      execEvenly: true, // Spread requests evenly across duration
    });

    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const key = options.keyGenerator ? options.keyGenerator(req) : req.ip || 'unknown';
        await rateLimiter.consume(key);
        next();
      } catch (rateLimiterRes: any) {
        const remainingPoints = (rateLimiterRes?.remainingPoints || 0) as number;
        const msBeforeNext = (rateLimiterRes?.msBeforeNext || 0) as number;

        res.set({
          'Retry-After': Math.round(msBeforeNext / 1000) || 1,
          'X-RateLimit-Limit': options.max.toString(),
          'X-RateLimit-Remaining': remainingPoints.toString(),
          'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext).toISOString(),
        });

        if (options.onLimitReached) {
          options.onLimitReached(req);
        }

        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          path: req.path,
          method: req.method,
          remainingPoints,
          msBeforeNext,
        });

        throw new RateLimitError('Too many requests, please slow down');
      }
    };
  }

  // Fallback to express-rate-limit
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    ...(options.keyGenerator && { keyGenerator: options.keyGenerator }),
    handler: (req: Request, res: Response) => {
      if (options.onLimitReached) {
        options.onLimitReached(req);
      }

      logger.warn('Rate limit exceeded (fallback)', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
      });

      const response: ApiResponse = {
        success: false,
        error: {
          message: 'Too many requests, please slow down',
          statusCode: 429,
          timestamp: new Date().toISOString(),
          suggestions: [
            'Wait before making another request',
            'Consider reducing request frequency',
            'Contact support if you need higher limits',
          ],
        },
      };

      res.status(429).json(response);
    },
  });
};

// General rate limiting
export const generalRateLimit = createAdvancedRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  skipSuccessfulRequests: false,
  onLimitReached: (req) => {
    logger.warn('General rate limit reached', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent'),
    });
  },
});

// Strict rate limiting for authentication endpoints
export const authRateLimit = createAdvancedRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `auth:${req.ip}:${req.body?.email || 'unknown'}`,
  onLimitReached: (req) => {
    logger.warn('Auth rate limit reached', {
      ip: req.ip,
      email: req.body?.email,
      path: req.path,
      userAgent: req.get('User-Agent'),
    });
  },
});

// API rate limiting based on API key or user
export const apiRateLimit = createAdvancedRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => {
    const userId = (req as any).user?.id;
    const apiKey = req.headers['x-api-key'] as string;
    return userId || apiKey || req.ip;
  },
  onLimitReached: (req) => {
    logger.warn('API rate limit reached', {
      userId: (req as any).user?.id,
      ip: req.ip,
      path: req.path,
    });
  },
});

// Slow down middleware for gradual degradation
export const slowDownMiddleware: any = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // Allow 100 requests at full speed
  delayMs: 500, // Add 500ms delay after delayAfter is reached
  maxDelayMs: 20000, // Maximum delay of 20 seconds
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
});

// Request size limiting
export const requestSizeLimit = (maxSizeBytes: number) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const contentLength = req.headers['content-length'];

    if (contentLength && parseInt(contentLength) > maxSizeBytes) {
      logger.warn('Request size exceeded', {
        ip: req.ip,
        path: req.path,
        contentLength,
        maxSize: maxSizeBytes,
      });

      throw new ValidationError('Request entity too large', {
        maxSize: maxSizeBytes,
        receivedSize: contentLength,
      });
    }

    return next();
  };
};

// IP whitelist/blacklist middleware
export const ipFilter = (options: {
  whitelist?: string[];
  blacklist?: string[];
  trustProxy?: boolean;
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIp = options.trustProxy
      ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
      : req.ip;

    // Check blacklist first
    if (options.blacklist && clientIp && options.blacklist.includes(clientIp)) {
      logger.warn('Blocked IP attempt', {
        ip: clientIp,
        path: req.path,
        userAgent: req.get('User-Agent'),
      });

      return res.status(403).json({
        success: false,
        error: {
          message: 'Access denied',
          statusCode: 403,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Check whitelist if provided
    if (options.whitelist && options.whitelist.length > 0) {
      if (!clientIp || !options.whitelist.includes(clientIp)) {
        logger.warn('Non-whitelisted IP attempt', {
          ip: clientIp,
          path: req.path,
          userAgent: req.get('User-Agent'),
        });

        return res.status(403).json({
          success: false,
          error: {
            message: 'Access denied',
            statusCode: 403,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    return next();
  };
};

// Request ID middleware for tracing
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId =
    (req.headers['x-request-id'] as string) ||
    `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);

  return next();
};

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Remove sensitive headers
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  // HSTS for HTTPS
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return next();
};

// CORS configuration
export const corsConfig = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowedOrigins = process.env['ALLOWED_ORIGINS']?.split(',') || ['http://localhost:3000'];

    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || process.env['NODE_ENV'] === 'development') {
      callback(null, true);
    } else {
      logger.warn('CORS origin blocked', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key',
    'X-Request-ID',
    'Cache-Control',
  ],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400, // 24 hours
};

// Input sanitization middleware
export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  const sanitizeValue = (value: any): any => {
    if (typeof value === 'string') {
      // Remove potentially dangerous characters
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+\s*=/gi, '') // Remove event handlers
        .trim();
    }

    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }

    if (value && typeof value === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = sanitizeValue(val);
      }
      return sanitized;
    }

    return value;
  };

  if (req.body) {
    req.body = sanitizeValue(req.body);
  }

  if (req.query) {
    req.query = sanitizeValue(req.query);
  }

  return next();
};

// SQL injection protection middleware
export const sqlInjectionProtection = (req: Request, _res: Response, next: NextFunction) => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/i,
    /(UNION\s+SELECT)/i,
    /(\bOR\s+1\s*=\s*1\b)/i,
    /(\bAND\s+1\s*=\s*1\b)/i,
    /(--|\#|\/\*|\*\/)/,
    /(\bxp_cmdshell\b)/i,
  ];

  const checkForSqlInjection = (value: any): boolean => {
    if (typeof value === 'string') {
      return sqlPatterns.some((pattern) => pattern.test(value));
    }

    if (Array.isArray(value)) {
      return value.some(checkForSqlInjection);
    }

    if (value && typeof value === 'object') {
      return Object.values(value).some(checkForSqlInjection);
    }

    return false;
  };

  const suspicious = [req.body, req.query, req.params].some(checkForSqlInjection);

  if (suspicious) {
    logger.warn('Potential SQL injection attempt', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
      body: req.body,
      query: req.query,
      params: req.params,
    });

    throw new ValidationError('Invalid input detected');
  }

  return next();
};

// Honeypot middleware to catch bots
export const honeypotMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Check for common bot patterns
  const userAgent = req.get('User-Agent') || '';
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /python-requests/i,
    /curl/i,
  ];

  const isSuspicious = suspiciousPatterns.some((pattern) => pattern.test(userAgent));

  // Check for honeypot fields in request body
  const honeypotFields = ['hp_field', 'bot_trap', 'email_confirm'];
  const hasHoneypotData = honeypotFields.some(
    (field) => req.body?.[field] !== undefined && req.body[field] !== ''
  );

  if (isSuspicious || hasHoneypotData) {
    logger.warn('Potential bot detected', {
      ip: req.ip,
      userAgent,
      path: req.path,
      honeypotTriggered: hasHoneypotData,
      suspiciousUA: isSuspicious,
    });

    // Respond with fake success to confuse bots
    return res.status(200).json({
      success: true,
      message: 'Request processed successfully',
    });
  }

  return next();
};

// Request logging with security context
export const securityLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  // Log request start
  logger.info('Request started', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.headers['x-request-id'],
    userId: (req as any).user?.id,
    contentLength: req.headers['content-length'],
    timestamp: new Date().toISOString(),
  });

  // Override end to log response
  const originalEnd = res.end;
  res.end = function (chunk: any, encoding?: any, cb?: any) {
    const duration = Date.now() - startTime;

    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      ip: req.ip,
      statusCode: res.statusCode,
      duration,
      requestId: req.headers['x-request-id'],
      userId: (req as any).user?.id,
      responseSize: res.get('Content-Length'),
      timestamp: new Date().toISOString(),
    });

    return originalEnd.call(this, chunk, encoding, cb);
  };

  return next();
};

// API key validation middleware
export const validateApiKey = (req: Request, _res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    throw new ValidationError('API key required');
  }

  // In a real implementation, you'd validate against a database
  const validApiKeys = process.env['VALID_API_KEYS']?.split(',') || [];

  if (!validApiKeys.includes(apiKey)) {
    logger.warn('Invalid API key attempt', {
      ip: req.ip,
      apiKey: apiKey.substring(0, 8) + '...',
      path: req.path,
      userAgent: req.get('User-Agent'),
    });

    throw new ValidationError('Invalid API key');
  }

  return next();
};

// Combine all security middleware
export const applySecurity = [
  requestIdMiddleware,
  securityHeaders,
  sanitizeInput,
  sqlInjectionProtection,
  securityLogger,
  generalRateLimit,
  slowDownMiddleware,
  requestSizeLimit(10 * 1024 * 1024), // 10MB limit
];

// High-security endpoints (auth, admin, etc.)
export const applyHighSecurity = [...applySecurity, honeypotMiddleware, authRateLimit];

export { createAdvancedRateLimit };
