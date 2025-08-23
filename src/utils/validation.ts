import { z } from 'zod';

/**
 * Validation schemas for better-auth integration
 * These can be used for additional validation in your API routes
 */

// User profile update schema
export const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, 'First name is required').max(50).optional(),
    lastName: z.string().min(1, 'Last name is required').max(50).optional(),
    phone: z
      .string()
      .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone number')
      .optional(),
    dateOfBirth: z.string().datetime().optional().or(z.date().optional()),
    timezone: z.string().optional(),
    currency: z.string().length(3, 'Currency must be 3 characters').optional(),
    monthlyIncome: z.number().positive().optional(),
  }),
});

// User registration validation (additional fields)
export const userRegistrationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, 'First name is required').max(50),
    lastName: z.string().min(1, 'Last name is required').max(50),
    phone: z
      .string()
      .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone number')
      .optional(),
    dateOfBirth: z.string().datetime().optional().or(z.date().optional()),
    timezone: z.string().default('UTC'),
    currency: z.string().length(3).default('USD'),
  }),
});

// Admin user management schema
export const adminUserSchema = z.object({
  body: z.object({
    role: z.enum(['USER', 'ADMIN', 'PREMIUM']).optional(),
    currentPlan: z.enum(['FREE', 'PRO', 'ULTIMATE']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  }),
});

// Query schemas for API endpoints
export const paginationSchema = z.object({
  query: z.object({
    page: z.string().transform(Number).default('1'),
    limit: z.string().transform(Number).default('10'),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  }),
});

// Middleware to validate requests
export const validate = (schema: z.ZodSchema) => {
  return (req: any, res: any, next: any) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors,
        });
      }
      next(error);
    }
  };
};
