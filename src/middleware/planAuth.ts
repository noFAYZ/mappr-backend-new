import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { PlanType } from '@prisma/client';
import { getPlanConfig } from '@/config/plans';
import { logger } from '@/utils/logger';

export interface PlanLimits {
  maxAccounts?: number;
  maxTransactions?: number;
  maxCategories?: number;
  maxBudgets?: number;
  maxGoals?: number;
  aiInsights?: boolean;
  advancedReports?: boolean;
  apiAccess?: boolean;
  exportData?: boolean;
  customCategories?: boolean;
}

export const requireFeature = (feature: keyof PlanLimits) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('User not authenticated', 401);
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { currentPlan: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const planConfig = getPlanConfig(user.currentPlan);
      const hasFeature = planConfig.features[feature];

      if (!hasFeature) {
        throw new AppError(
          `This feature requires a ${feature === 'aiInsights' ? 'Pro' : 'higher'} plan. Please upgrade your subscription.`,
          403
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const enforceLimit = (limitType: keyof PlanLimits, resourceName: string) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('User not authenticated', 401);
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { currentPlan: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const planConfig = getPlanConfig(user.currentPlan);
      const limit = planConfig.features[limitType] as number;

      // -1 means unlimited
      if (limit === -1) {
        return next();
      }

      // Count current resources based on type
      let currentCount = 0;

      switch (limitType) {
        case 'maxAccounts':
          currentCount = await prisma.account.count({
            where: { userId: req.user.id },
          });
          break;
        case 'maxTransactions':
          currentCount = await prisma.transaction.count({
            where: { account: { userId: req.user.id } },
          });
          break;
        case 'maxCategories':
          currentCount = await prisma.category.count({
            where: { userId: req.user.id },
          });
          break;
        case 'maxBudgets':
          currentCount = await prisma.budget.count({
            where: { userId: req.user.id },
          });
          break;
        case 'maxGoals':
          currentCount = await prisma.goal.count({
            where: { userId: req.user.id },
          });
          break;
        default:
          return next();
      }

      if (currentCount >= limit) {
        throw new AppError(
          `You have reached the maximum number of ${resourceName} (${limit}) for your ${user.currentPlan.toLowerCase()} plan. Please upgrade to add more.`,
          403
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const checkUsage = async (
  userId: string,
  feature: string
): Promise<{ allowed: boolean; reason?: string }> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { currentPlan: true },
    });

    if (!user) {
      return { allowed: false, reason: 'User not found' };
    }

    const planConfig = getPlanConfig(user.currentPlan);

    // Check if feature is available in plan
    const featureKey = feature as keyof PlanLimits;
    const featureValue = planConfig.features[featureKey];

    if (typeof featureValue === 'boolean') {
      return {
        allowed: featureValue,
        ...(featureValue
          ? {}
          : { reason: `Feature not available in ${user.currentPlan.toLowerCase()} plan` }),
      };
    }

    if (typeof featureValue === 'number') {
      // For numeric limits, we need to check current usage
      let currentCount = 0;

      switch (featureKey) {
        case 'maxAccounts':
          currentCount = await prisma.account.count({ where: { userId } });
          break;
        case 'maxTransactions':
          currentCount = await prisma.transaction.count({
            where: { account: { userId } },
          });
          break;
        case 'maxCategories':
          currentCount = await prisma.category.count({ where: { userId } });
          break;
        case 'maxBudgets':
          currentCount = await prisma.budget.count({ where: { userId } });
          break;
        case 'maxGoals':
          currentCount = await prisma.goal.count({ where: { userId } });
          break;
      }

      const allowed = featureValue === -1 || currentCount < featureValue;
      return {
        allowed,
        ...(allowed ? {} : { reason: `Limit reached: ${currentCount}/${featureValue}` }),
      };
    }

    return { allowed: true };
  } catch (error) {
    logger.error('Error checking usage:', error);
    return { allowed: false, reason: 'Error checking usage limits' };
  }
};

export const requirePlan = (requiredPlan: PlanType | PlanType[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('User not authenticated', 401);
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { currentPlan: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const allowedPlans = Array.isArray(requiredPlan) ? requiredPlan : [requiredPlan];

      if (!allowedPlans.includes(user.currentPlan)) {
        const planNames = allowedPlans.map((plan) => plan.toLowerCase()).join(', ');
        throw new AppError(
          `This feature requires ${planNames} plan. Please upgrade your subscription.`,
          403
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
