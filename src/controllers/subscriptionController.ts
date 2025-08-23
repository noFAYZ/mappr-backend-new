import { Request, Response, NextFunction } from 'express';
import { subscriptionService } from '@/services/subscriptionService';
import { AppError } from '@/middleware/errorHandler';
import { PlanType, BillingPeriod } from '@prisma/client';
import { PLAN_CONFIGS, getAllPlans } from '@/config/plans';

export const getPlans = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = await subscriptionService.getPlans();

    // Enhance with configuration data
    const enhancedPlans = plans.map((plan) => {
      const config = PLAN_CONFIGS[plan.type];
      return {
        ...plan,
        popular: config.popular || false,
        yearlyDiscount: config.yearlyDiscount,
        trialDays: config.trialDays || 0,
        features: config.features,
      };
    });

    res.status(200).json({
      success: true,
      data: enhancedPlans,
    });
  } catch (error) {
    next(error);
  }
};

export const getPlanComparison = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = getAllPlans();

    res.status(200).json({
      success: true,
      data: {
        plans,
        comparison: {
          features: [
            'maxAccounts',
            'maxTransactions',
            'maxCategories',
            'maxBudgets',
            'maxGoals',
            'aiInsights',
            'advancedReports',
            'prioritySupport',
            'apiAccess',
            'exportData',
            'customCategories',
            'bankSync',
            'multiCurrency',
            'collaborativeAccounts',
            'investmentTracking',
            'taxReporting',
          ],
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getCurrentSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const subscription = await subscriptionService.getUserSubscription(req.user.id);

    res.status(200).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

export const createSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { planType, billingPeriod, paymentMethodId } = req.body;

    // Validate input
    if (!Object.values(PlanType).includes(planType)) {
      throw new AppError('Invalid plan type', 400);
    }

    if (!Object.values(BillingPeriod).includes(billingPeriod)) {
      throw new AppError('Invalid billing period', 400);
    }

    const subscription = await subscriptionService.createSubscription({
      userId: req.user.id,
      planType,
      billingPeriod,
      paymentMethodId,
    });

    res.status(201).json({
      success: true,
      message: 'Subscription created successfully',
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { planType, billingPeriod } = req.body;

    // Validate input
    if (planType && !Object.values(PlanType).includes(planType)) {
      throw new AppError('Invalid plan type', 400);
    }

    if (billingPeriod && !Object.values(BillingPeriod).includes(billingPeriod)) {
      throw new AppError('Invalid billing period', 400);
    }

    const subscription = await subscriptionService.updateSubscription(req.user.id, {
      planType,
      billingPeriod,
    });

    res.status(200).json({
      success: true,
      message: 'Subscription updated successfully',
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

export const cancelSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { immediately } = req.body;

    const subscription = await subscriptionService.cancelSubscription(
      req.user.id,
      immediately === true
    );

    res.status(200).json({
      success: true,
      message: immediately
        ? 'Subscription cancelled immediately'
        : 'Subscription will be cancelled at the end of the current period',
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

export const reactivateSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const subscription = await subscriptionService.reactivateSubscription(req.user.id);

    res.status(200).json({
      success: true,
      message: 'Subscription reactivated successfully',
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

export const getSubscriptionHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const history = await subscriptionService.getSubscriptionHistory(req.user.id);

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

export const upgradeSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { planType, billingPeriod } = req.body;

    if (!planType) {
      throw new AppError('Plan type is required', 400);
    }

    // Get current subscription
    const currentSub = await subscriptionService.getUserSubscription(req.user.id);

    // Validate this is actually an upgrade
    const planHierarchy: Record<PlanType, number> = {
      [PlanType.FREE]: 0,
      [PlanType.PRO]: 1,
      [PlanType.ULTIMATE]: 2,
    };

    if (planHierarchy[planType as PlanType] <= planHierarchy[currentSub.currentPlan as PlanType]) {
      throw new AppError('This is not an upgrade', 400);
    }

    const subscription = await subscriptionService.updateSubscription(req.user.id, {
      planType,
      billingPeriod: billingPeriod || BillingPeriod.MONTHLY,
    });

    res.status(200).json({
      success: true,
      message: `Successfully upgraded to ${planType} plan`,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

export const downgradeSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { planType } = req.body;

    if (!planType) {
      throw new AppError('Plan type is required', 400);
    }

    // Get current subscription
    const currentSub = await subscriptionService.getUserSubscription(req.user.id);

    // Validate this is actually a downgrade
    const planHierarchy: Record<PlanType, number> = {
      [PlanType.FREE]: 0,
      [PlanType.PRO]: 1,
      [PlanType.ULTIMATE]: 2,
    };

    if (planHierarchy[planType as PlanType] >= planHierarchy[currentSub.currentPlan as PlanType]) {
      throw new AppError('This is not a downgrade', 400);
    }

    const subscription = await subscriptionService.updateSubscription(req.user.id, {
      planType,
    });

    res.status(200).json({
      success: true,
      message: `Successfully downgraded to ${planType} plan`,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};
