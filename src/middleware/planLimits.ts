import { Request, Response, NextFunction } from 'express';
import { planLimitsService, LimitError } from '@/services/planLimitsService';

interface PlanLimitMiddleware {
  (req: Request, res: Response, next: NextFunction): Promise<void>;
}

export const enforceWalletLimit: PlanLimitMiddleware = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'User authentication required',
        },
      });
      return;
    }

    await planLimitsService.enforceWalletLimit(req.user.id);
    next();
  } catch (error) {
    if (error instanceof Error && (error as LimitError).code) {
      const limitError = error as LimitError;
      res.status(limitError.statusCode || 403).json({
        success: false,
        error: {
          code: limitError.code,
          message: limitError.message,
          details: limitError.details,
        },
      });
      return;
    }

    console.error('Error enforcing wallet limit:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An internal error occurred while checking wallet limits',
      },
    });
    return;
  }
};

export const enforceAccountLimit: PlanLimitMiddleware = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'User authentication required',
        },
      });
      return;
    }

    await planLimitsService.enforceAccountLimit(req.user.id);
    next();
  } catch (error) {
    if (error instanceof Error && (error as LimitError).code) {
      const limitError = error as LimitError;
      res.status(limitError.statusCode || 403).json({
        success: false,
        error: {
          code: limitError.code,
          message: limitError.message,
          details: limitError.details,
        },
      });
      return;
    }

    console.error('Error enforcing account limit:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An internal error occurred while checking account limits',
      },
    });
    return;
  }
};

export const checkLimits = (limitType: 'wallet' | 'account'): PlanLimitMiddleware => {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'User authentication required',
          },
        });
        return;
      }

      if (limitType === 'wallet') {
        const result = await planLimitsService.checkWalletLimit(req.user.id);
        (req as any).limitCheck = result;
      } else if (limitType === 'account') {
        const result = await planLimitsService.checkAccountLimit(req.user.id);
        (req as any).limitCheck = result;
      }

      next();
    } catch (error) {
      console.error(`Error checking ${limitType} limits:`, error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: `An internal error occurred while checking ${limitType} limits`,
        },
      });
      return;
    }
  };
};
