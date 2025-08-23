import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { PlanType, BillingPeriod, SubscriptionStatus } from '@prisma/client';
import { getPlanConfig, canUpgradeTo, canDowngradeTo } from '@/config/plans';

export interface CreateSubscriptionRequest {
  userId: string;
  planType: PlanType;
  billingPeriod: BillingPeriod;
  paymentMethodId?: string;
}

export interface UpdateSubscriptionRequest {
  planType?: PlanType;
  billingPeriod?: BillingPeriod;
}

export class SubscriptionService {
  async getPlans() {
    try {
      const plans = await prisma.plan.findMany({
        where: { isActive: true },
        orderBy: [{ monthlyPrice: 'asc' }, { type: 'asc' }],
      });

      return plans;
    } catch (error) {
      logger.error('Error fetching plans:', error);
      throw new AppError('Failed to fetch plans', 500);
    }
  }

  async getUserSubscription(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      return {
        currentPlan: user.currentPlan,
        subscription: user.subscription,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error fetching user subscription:', error);
      throw new AppError('Failed to fetch subscription', 500);
    }
  }

  async createSubscription(data: CreateSubscriptionRequest) {
    try {
      const { userId, planType, billingPeriod } = data;

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { subscription: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Check if user already has an active subscription
      if (user.subscription && user.subscription.status === SubscriptionStatus.ACTIVE) {
        throw new AppError('User already has an active subscription', 400);
      }

      // Get plan configuration
      const planConfig = getPlanConfig(planType);
      if (!planConfig) {
        throw new AppError('Invalid plan type', 400);
      }

      // Calculate pricing
      const amount =
        billingPeriod === BillingPeriod.YEARLY ? planConfig.yearlyPrice : planConfig.monthlyPrice;

      // Calculate period end
      const currentPeriodStart = new Date();
      const currentPeriodEnd = new Date();
      if (billingPeriod === BillingPeriod.YEARLY) {
        currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
      } else {
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      }

      // Create subscription in transaction
      const result = await prisma.$transaction(async (tx) => {
        // Delete existing subscription if exists
        if (user.subscription) {
          await tx.subscription.delete({
            where: { id: user.subscription.id },
          });
        }

        // Create new subscription
        const subscription = await tx.subscription.create({
          data: {
            userId,
            planType,
            status:
              planType === PlanType.FREE ? SubscriptionStatus.ACTIVE : SubscriptionStatus.TRIAL,
            billingPeriod,
            amount,
            currentPeriodStart,
            currentPeriodEnd,
            ...(planConfig.trialDays &&
              planConfig.trialDays > 0 &&
              planType !== PlanType.FREE && {
                trialStart: new Date(),
                trialEnd: new Date(Date.now() + planConfig.trialDays * 24 * 60 * 60 * 1000),
              }),
          },
          include: {
            plan: true,
          },
        });

        // Update user's current plan
        await tx.user.update({
          where: { id: userId },
          data: {
            currentPlan: planType,
            subscriptionId: subscription.id,
          },
        });

        return subscription;
      });

      logger.info(`Subscription created for user ${userId}: ${planType}`);
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error creating subscription:', error);
      throw new AppError('Failed to create subscription', 500);
    }
  }

  async updateSubscription(userId: string, data: UpdateSubscriptionRequest) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { subscription: true },
      });

      if (!user || !user.subscription) {
        throw new AppError('No active subscription found', 404);
      }

      const currentSubscription = user.subscription;
      const updateData: any = {};

      // Handle plan type change
      if (data.planType && data.planType !== currentSubscription.planType) {
        // Validate plan change
        if (
          !canUpgradeTo(currentSubscription.planType, data.planType) &&
          !canDowngradeTo(currentSubscription.planType, data.planType)
        ) {
          throw new AppError('Invalid plan change', 400);
        }

        const newPlanConfig = getPlanConfig(data.planType);
        updateData.planType = data.planType;
        updateData.amount =
          data.billingPeriod === BillingPeriod.YEARLY ||
          currentSubscription.billingPeriod === BillingPeriod.YEARLY
            ? newPlanConfig.yearlyPrice
            : newPlanConfig.monthlyPrice;
      }

      // Handle billing period change
      if (data.billingPeriod && data.billingPeriod !== currentSubscription.billingPeriod) {
        const planConfig = getPlanConfig(data.planType || currentSubscription.planType);
        updateData.billingPeriod = data.billingPeriod;
        updateData.amount =
          data.billingPeriod === BillingPeriod.YEARLY
            ? planConfig.yearlyPrice
            : planConfig.monthlyPrice;
      }

      // Update subscription and user
      const result = await prisma.$transaction(async (tx) => {
        const updatedSubscription = await tx.subscription.update({
          where: { id: currentSubscription.id },
          data: updateData,
          include: { plan: true },
        });

        if (data.planType) {
          await tx.user.update({
            where: { id: userId },
            data: { currentPlan: data.planType },
          });
        }

        return updatedSubscription;
      });

      logger.info(`Subscription updated for user ${userId}`);
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error updating subscription:', error);
      throw new AppError('Failed to update subscription', 500);
    }
  }

  async cancelSubscription(userId: string, cancelImmediately: boolean = false) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { subscription: true },
      });

      if (!user || !user.subscription) {
        throw new AppError('No active subscription found', 404);
      }

      const subscription = user.subscription;

      if (subscription.status === SubscriptionStatus.CANCELLED) {
        throw new AppError('Subscription is already cancelled', 400);
      }

      const updateData: any = {
        status: SubscriptionStatus.CANCELLED,
        canceledAt: new Date(),
      };

      if (cancelImmediately) {
        updateData.endDate = new Date();
        // Downgrade to free plan immediately
        await prisma.user.update({
          where: { id: userId },
          data: { currentPlan: PlanType.FREE },
        });
      } else {
        // Cancel at period end
        updateData.cancelAt = subscription.currentPeriodEnd;
      }

      const result = await prisma.subscription.update({
        where: { id: subscription.id },
        data: updateData,
        include: { plan: true },
      });

      logger.info(`Subscription cancelled for user ${userId}, immediate: ${cancelImmediately}`);
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error cancelling subscription:', error);
      throw new AppError('Failed to cancel subscription', 500);
    }
  }

  async reactivateSubscription(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { subscription: true },
      });

      if (!user || !user.subscription) {
        throw new AppError('No subscription found', 404);
      }

      const subscription = user.subscription;

      if (subscription.status !== SubscriptionStatus.CANCELLED) {
        throw new AppError('Subscription is not cancelled', 400);
      }

      // Check if we can still reactivate (before period end)
      if (subscription.cancelAt && new Date() > subscription.cancelAt) {
        throw new AppError('Cannot reactivate expired subscription', 400);
      }

      const result = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          cancelAt: null,
          canceledAt: null,
        },
        include: { plan: true },
      });

      logger.info(`Subscription reactivated for user ${userId}`);
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error reactivating subscription:', error);
      throw new AppError('Failed to reactivate subscription', 500);
    }
  }

  async getSubscriptionHistory(userId: string) {
    try {
      const payments = await prisma.payment.findMany({
        where: {
          subscription: {
            userId,
          },
        },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return payments;
    } catch (error) {
      logger.error('Error fetching subscription history:', error);
      throw new AppError('Failed to fetch subscription history', 500);
    }
  }
}

export const subscriptionService = new SubscriptionService();
