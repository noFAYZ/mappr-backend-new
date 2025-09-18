import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ValidationError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
// import { ValidationRule, ValidationResult } from '@/types/common';

// Custom Joi extensions for common patterns
const customJoi = Joi.extend(
  {
    type: 'ethereumAddress',
    base: Joi.string(),
    messages: {
      'ethereumAddress.invalid': 'Must be a valid Ethereum address',
    },
    validate: (value, helpers) => {
      if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
        return { value, errors: helpers.error('ethereumAddress.invalid') };
      }
      return { value };
    },
  },
  {
    type: 'cryptoHash',
    base: Joi.string(),
    messages: {
      'cryptoHash.invalid': 'Must be a valid crypto transaction hash',
    },
    validate: (value, helpers) => {
      if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
        return { value, errors: helpers.error('cryptoHash.invalid') };
      }
      return { value };
    },
  },
  {
    type: 'strongPassword',
    base: Joi.string(),
    messages: {
      'strongPassword.weak':
        'Password must contain at least 8 characters, including uppercase, lowercase, number, and special character',
    },
    validate: (value, helpers) => {
      const strongPasswordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
      if (!strongPasswordRegex.test(value)) {
        return { value, errors: helpers.error('strongPassword.weak') };
      }
      return { value };
    },
  }
);

// Common validation schemas
export const schemas = {
  // User validation schemas
  userRegistration: customJoi.object({
    email: Joi.string().email().required().max(255),
    password: customJoi.strongPassword().required(),
    firstName: Joi.string().trim().min(1).max(100).required(),
    lastName: Joi.string().trim().min(1).max(100).required(),
    timezone: Joi.string().optional(),
    language: Joi.string().length(2).optional(),
    acceptedTerms: Joi.boolean().valid(true).required(),
    honeypot: Joi.string().empty('').optional(), // Honeypot field
  }),

  userLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(1).required(),
    rememberMe: Joi.boolean().optional(),
    honeypot: Joi.string().empty('').optional(),
  }),

  userUpdate: Joi.object({
    firstName: Joi.string().trim().min(1).max(100).optional(),
    lastName: Joi.string().trim().min(1).max(100).optional(),
    timezone: Joi.string().optional(),
    language: Joi.string().length(2).optional(),
    preferences: Joi.object().optional(),
  }),

  passwordChange: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: customJoi.strongPassword().required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required(),
  }),

  // Wallet validation schemas
  walletCreate: Joi.object({
    address: customJoi.ethereumAddress().required(),
    network: Joi.string()
      .valid(
        'ETHEREUM',
        'POLYGON',
        'BSC',
        'ARBITRUM',
        'OPTIMISM',
        'AVALANCHE',
        'BASE',
        'SOLANA',
        'BITCOIN'
      )
      .required(),
    name: Joi.string().trim().min(1).max(100).optional(),
    label: Joi.string().trim().max(50).optional(),
    isWatching: Joi.boolean().default(true),
  }),

  walletUpdate: Joi.object({
    name: Joi.string().trim().min(1).max(100).optional(),
    label: Joi.string().trim().max(50).optional(),
    isWatching: Joi.boolean().optional(),
    isActive: Joi.boolean().optional(),
  }),

  // Transaction validation schemas
  transactionCreate: Joi.object({
    hash: customJoi.cryptoHash().required(),
    network: Joi.string()
      .valid(
        'ETHEREUM',
        'POLYGON',
        'BSC',
        'ARBITRUM',
        'OPTIMISM',
        'AVALANCHE',
        'BASE',
        'SOLANA',
        'BITCOIN'
      )
      .required(),
    type: Joi.string()
      .valid(
        'SEND',
        'RECEIVE',
        'SWAP',
        'APPROVAL',
        'CONTRACT_INTERACTION',
        'NFT_TRANSFER',
        'DEFI_INTERACTION'
      )
      .required(),
    fromAddress: customJoi.ethereumAddress().optional(),
    toAddress: customJoi.ethereumAddress().optional(),
    amount: Joi.number().min(0).optional(),
    valueUsd: Joi.number().min(0).optional(),
    gasUsed: Joi.number().min(0).optional(),
    gasPrice: Joi.number().min(0).optional(),
    timestamp: Joi.date().iso().required(),
    blockNumber: Joi.number().integer().min(0).optional(),
  }),

  // Pagination and filtering schemas
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    orderBy: Joi.string().optional(),
    order: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  dateRange: Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
  }),

  // Search and filter schemas
  walletFilters: Joi.object({
    networks: Joi.array().items(Joi.string()).optional(),
    minBalance: Joi.number().min(0).optional(),
    maxBalance: Joi.number().min(Joi.ref('minBalance')).optional(),
    hasPositions: Joi.boolean().optional(),
    search: Joi.string().trim().max(100).optional(),
  }),

  transactionFilters: Joi.object({
    networks: Joi.array().items(Joi.string()).optional(),
    types: Joi.array().items(Joi.string()).optional(),
    minValue: Joi.number().min(0).optional(),
    maxValue: Joi.number().min(Joi.ref('minValue')).optional(),
    search: Joi.string().trim().max(100).optional(),
  }),

  // Admin schemas
  adminUserUpdate: Joi.object({
    role: Joi.string().valid('USER', 'ADMIN', 'MODERATOR').optional(),
    status: Joi.string().valid('ACTIVE', 'SUSPENDED', 'BANNED').optional(),
    reason: Joi.string().trim().max(500).optional(),
  }),

  // API key schemas
  apiKeyCreate: Joi.object({
    name: Joi.string().trim().min(1).max(100).required(),
    permissions: Joi.array().items(Joi.string()).required(),
    expiresAt: Joi.date().iso().greater('now').optional(),
  }),

  // Subscription schemas
  subscriptionCreate: Joi.object({
    plan: Joi.string().valid('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE').required(),
    paymentMethodId: Joi.string().required(),
    billingCycle: Joi.string().valid('MONTHLY', 'YEARLY').default('MONTHLY'),
  }),
};

// Validation middleware factory
export function validate(schema: Joi.ObjectSchema, location: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = req[location];
      const { error, value } = schema.validate(data, {
        abortEarly: false, // Return all errors
        stripUnknown: true, // Remove unknown properties
        convert: true, // Convert types when possible
        allowUnknown: false, // Don't allow unknown properties
      });

      if (error) {
        const validationErrors = error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value,
        }));

        logger.warn('Validation failed', {
          location,
          errors: validationErrors,
          originalData: data,
          requestId: req.headers['x-request-id'],
          userId: (req as any).user?.id,
          ip: req.ip,
          path: req.path,
        });

        throw new ValidationError('Validation failed', {
          errors: validationErrors,
          location,
        });
      }

      // Replace the original data with validated and converted data
      req[location] = value;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Combined validation for multiple locations
export function validateMultiple(
  validations: Array<{
    schema: Joi.ObjectSchema;
    location: 'body' | 'query' | 'params';
  }>
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const errors: Array<{
        location: string;
        field: string;
        message: string;
        value?: any;
      }> = [];

      for (const { schema, location } of validations) {
        const data = req[location];
        const { error, value } = schema.validate(data, {
          abortEarly: false,
          stripUnknown: true,
          convert: true,
          allowUnknown: false,
        });

        if (error) {
          errors.push(
            ...error.details.map((detail) => ({
              location,
              field: detail.path.join('.'),
              message: detail.message,
              value: detail.context?.value,
            }))
          );
        } else {
          req[location] = value;
        }
      }

      if (errors.length > 0) {
        logger.warn('Multi-location validation failed', {
          errors,
          requestId: req.headers['x-request-id'],
          userId: (req as any).user?.id,
          ip: req.ip,
          path: req.path,
        });

        throw new ValidationError('Validation failed', { errors });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

// Conditional validation based on request context
export function conditionalValidate(
  condition: (req: Request) => boolean,
  schema: Joi.ObjectSchema,
  location: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (condition(req)) {
      return validate(schema, location)(req, _res, next);
    }
    next();
  };
}

// Custom validation for file uploads
export function validateFileUpload(options: {
  allowedMimeTypes?: string[];
  maxFileSize?: number;
  maxFiles?: number;
  required?: boolean;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const files = (req as any).files as any[] | undefined;

    if (options.required && (!files || files.length === 0)) {
      throw new ValidationError('File upload is required');
    }

    if (files && files.length > 0) {
      // Check number of files
      if (options.maxFiles && files.length > options.maxFiles) {
        throw new ValidationError(`Maximum ${options.maxFiles} files allowed`);
      }

      // Validate each file
      for (const file of files) {
        // Check file size
        if (options.maxFileSize && file.size > options.maxFileSize) {
          throw new ValidationError(
            `File ${file.originalname} exceeds maximum size of ${options.maxFileSize} bytes`
          );
        }

        // Check MIME type
        if (options.allowedMimeTypes && !options.allowedMimeTypes.includes(file.mimetype)) {
          throw new ValidationError(
            `File ${file.originalname} has invalid type. Allowed types: ${options.allowedMimeTypes.join(', ')}`
          );
        }
      }
    }

    next();
  };
}

// Validate array of items
export function validateArray(
  itemSchema: Joi.Schema,
  options: {
    min?: number;
    max?: number;
    unique?: boolean;
  } = {}
) {
  const arraySchema = Joi.array()
    .items(itemSchema)
    .min(options.min || 0)
    .max(options.max || 1000);

  if (options.unique) {
    arraySchema.unique();
  }

  return validate(arraySchema as unknown as Joi.ObjectSchema);
}

// Sanitize and validate user input for XSS prevention
export function sanitizeAndValidate(
  schema: Joi.ObjectSchema,
  location: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = req[location];

      // First sanitize the data
      const sanitizedData = sanitizeForXSS(data);

      // Then validate
      const { error, value } = schema.validate(sanitizedData, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
        allowUnknown: false,
      });

      if (error) {
        const validationErrors = error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value,
        }));

        throw new ValidationError('Validation failed', {
          errors: validationErrors,
          location,
        });
      }

      req[location] = value;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// XSS sanitization function
function sanitizeForXSS(data: any): any {
  if (typeof data === 'string') {
    return data
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeForXSS);
  }

  if (data && typeof data === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeForXSS(value);
    }
    return sanitized;
  }

  return data;
}

// Rate limit validation for specific fields
export function validateRateLimit(field: string, maxPerHour: number) {
  const attempts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const value = req.body?.[field] || req.query?.[field];
    if (!value) return next();

    const key = `${req.ip}:${field}:${value}`;
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    const attempt = attempts.get(key);
    if (!attempt || now > attempt.resetTime) {
      attempts.set(key, { count: 1, resetTime: now + hourMs });
      return next();
    }

    if (attempt.count >= maxPerHour) {
      logger.warn('Field rate limit exceeded', {
        field,
        value: typeof value === 'string' ? value.substring(0, 10) + '...' : value,
        ip: req.ip,
        attempts: attempt.count,
      });

      throw new ValidationError(`Too many attempts for ${field}. Please try again later.`);
    }

    attempt.count++;
    next();
  };
}

// Common validation middleware combinations
export const validateUserRegistration = [
  validate(schemas.userRegistration),
  validateRateLimit('email', 5), // Max 5 registration attempts per email per hour
];

export const validateUserLogin = [
  validate(schemas.userLogin),
  validateRateLimit('email', 10), // Max 10 login attempts per email per hour
];

export const validateWalletCreate = [
  validate(schemas.walletCreate),
  validateRateLimit('address', 3), // Max 3 wallet additions per address per hour
];

export const validatePaginationQuery = validate(schemas.pagination, 'query');
export const validateDateRangeQuery = validate(schemas.dateRange, 'query');

// Export common schemas for reuse
export { customJoi as Joi };
