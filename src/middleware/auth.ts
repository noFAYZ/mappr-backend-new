import { Request, Response, NextFunction } from 'express';
import { auth, Session } from '@/lib/auth';
import { logger } from '@/utils/logger';
import { prisma } from '@/config/database';

// Define extended user type with comprehensive fields
interface ExtendedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  image?: string;
  firstName: string;
  lastName: string;
  role: string;
  currentPlan: string;
  status?: string;
  phone?: string | null;
  currency?: string;
  timezone?: string;
  monthlyIncome?: number;
  profilePicture?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  lastLoginAt?: Date;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: ExtendedUser;
      session?: Session;
    }
  }
}

/**
 * Enhanced middleware to check if user is authenticated
 * Adds user and session to request object if valid
 * Includes comprehensive user data fetching and validation
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers as any,
      query: req.query as any,
    });

    if (session?.user) {
      // Fetch comprehensive user data from database
      const fullUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          id: true,
          email: true,
          emailVerified: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          status: true,
          currentPlan: true,
          monthlyIncome: true,
          currency: true,
          timezone: true,
          profilePicture: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      if (!fullUser) {
        logger.warn(`Session exists but user not found in database: ${session.user.id}`);
        next();
        return;
      }

      // Check if user account is active
      if (fullUser.status === 'SUSPENDED' || fullUser.status === 'INACTIVE') {
        res.status(403).json({
          error: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been suspended. Please contact support.',
        });
        return;
      }

      // Update last login timestamp
      if (req.method !== 'GET') {
        await prisma.user
          .update({
            where: { id: fullUser.id },
            data: { lastLoginAt: new Date() },
          })
          .catch((error) => {
            logger.error('Failed to update last login:', error);
          });
      }

      req.user = {
        ...session.user,
        ...fullUser,
        monthlyIncome: fullUser.monthlyIncome ? Number(fullUser.monthlyIncome) : undefined,
      } as ExtendedUser;
      req.session = session as any;

      logger.debug(`User authenticated: ${fullUser.email} (${fullUser.id})`);
    }

    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    next();
  }
};

/**
 * Enhanced middleware to require authentication
 * Returns 401 if user is not authenticated
 * Includes comprehensive validation and error handling
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check if user was already authenticated by previous middleware
    if (req.user && req.session) {
      next();
      return;
    }

    const session = await auth.api.getSession({
      headers: req.headers as any,
      query: req.query as any,
    });

    if (!session?.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required. Please sign in to continue.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    // Fetch comprehensive user data
    const fullUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        currentPlan: true,
        monthlyIncome: true,
        currency: true,
        timezone: true,
        profilePicture: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!fullUser) {
      logger.error(`Session exists but user not found in database: ${session.user.id}`);
      res.status(401).json({
        error: 'INVALID_SESSION',
        message: 'User session is invalid. Please sign in again.',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    // Check if user account is active
    if (fullUser.status === 'SUSPENDED') {
      res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended. Please contact support.',
        code: 'ACCOUNT_SUSPENDED',
        supportEmail: process.env['SUPPORT_EMAIL'] || 'support@mappr.com',
      });
      return;
    }

    if (fullUser.status === 'INACTIVE') {
      res.status(403).json({
        error: 'ACCOUNT_INACTIVE',
        message: 'Your account is inactive. Please reactivate your account.',
        code: 'ACCOUNT_INACTIVE',
      });
      return;
    }

    // Check if email is verified for production
    if (process.env['NODE_ENV'] === 'production' && !fullUser.emailVerified) {
      res.status(403).json({
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address to continue.',
        code: 'EMAIL_VERIFICATION_REQUIRED',
      });
      return;
    }

    // Update last login timestamp for non-GET requests
    if (req.method !== 'GET') {
      await prisma.user
        .update({
          where: { id: fullUser.id },
          data: { lastLoginAt: new Date() },
        })
        .catch((error) => {
          logger.error('Failed to update last login:', error);
        });
    }

    req.user = {
      ...session.user,
      ...fullUser,
      monthlyIncome: fullUser.monthlyIncome ? Number(fullUser.monthlyIncome) : undefined,
    } as ExtendedUser;
    req.session = session as any;

    logger.debug(`User authenticated successfully: ${fullUser.email}`);
    next();
  } catch (error) {
    logger.error('RequireAuth middleware error:', error);
    res.status(401).json({
      error: 'AUTHENTICATION_ERROR',
      message: 'Invalid or expired session. Please sign in again.',
      code: 'SESSION_INVALID',
    });
    return;
  }
};

/**
 * Enhanced middleware to require specific roles
 * Includes detailed logging and better error messages
 */
export const requireRole = (...roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // First ensure user is authenticated
    if (!req.user || !req.session) {
      await requireAuth(req, res, () => {});
      if (!req.user || !req.session) return; // requireAuth already sent response
    }

    const userRole = req.user.role || 'USER';

    if (!roles.includes(userRole)) {
      logger.warn(
        `Access denied for user ${req.user.email}: required roles [${roles.join(', ')}], user has [${userRole}]`
      );

      res.status(403).json({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: `Access denied. This action requires one of the following roles: ${roles.join(', ')}.`,
        code: 'ROLE_REQUIRED',
        userRole,
        requiredRoles: roles,
      });
      return;
    }

    logger.debug(
      `Role check passed for user ${req.user.email}: ${userRole} in [${roles.join(', ')}]`
    );
    next();
  };
};

/**
 * Middleware to check if user has specific plan
 * Enhanced for subscription-based access control
 */
export const requirePlan = (...plans: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // First ensure user is authenticated
    if (!req.user || !req.session) {
      await requireAuth(req, res, () => {});
      if (!req.user || !req.session) return;
    }

    const userPlan = req.user.currentPlan || 'FREE';

    if (!plans.includes(userPlan)) {
      logger.warn(
        `Plan access denied for user ${req.user.email}: required plans [${plans.join(', ')}], user has [${userPlan}]`
      );

      res.status(402).json({
        error: 'SUBSCRIPTION_REQUIRED',
        message: `This feature requires a subscription. Please upgrade to one of: ${plans.join(', ')}.`,
        code: 'PLAN_UPGRADE_REQUIRED',
        userPlan,
        requiredPlans: plans,
        upgradeUrl: process.env['UPGRADE_URL'] || '/subscriptions',
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to check if user is admin
 */
export const requireAdmin = requireRole('ADMIN');

/**
 * Middleware to check if user is premium or admin
 */
export const requirePremium = requireRole('PREMIUM', 'ADMIN');

/**
 * Middleware for features requiring paid plans
 */
export const requirePaidPlan = requirePlan('PRO', 'ULTIMATE');

/**
 * Middleware for premium features only
 */
export const requireUltimatePlan = requirePlan('ULTIMATE');

/**
 * Middleware to check email verification status
 */
export const requireVerifiedEmail = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !req.session) {
    await requireAuth(req, res, () => {});
    if (!req.user || !req.session) return;
  }

  if (!req.user.emailVerified) {
    res.status(403).json({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email address to access this feature.',
      code: 'EMAIL_VERIFICATION_REQUIRED',
      resendUrl: '/api/auth/send-verification-email',
    });
    return;
  }

  next();
};

/**
 * Combined middleware for features requiring verification and paid plan
 */
export const requireVerifiedPaidUser = [requireVerifiedEmail, requirePaidPlan];

/**
 * Get current user helper function for controllers
 */
export const getCurrentUser = (req: Request): ExtendedUser | null => {
  return req.user || null;
};

/**
 * Assert authenticated user helper (throws if not authenticated)
 */
export const assertAuthenticatedUser = (req: Request): ExtendedUser => {
  if (!req.user) {
    throw new Error('User not authenticated');
  }
  return req.user;
};
