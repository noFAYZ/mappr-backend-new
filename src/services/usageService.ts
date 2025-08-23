import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { getPlanConfig } from '@/config/plans';

export interface UsageData {
  userId: string;
  feature: string;
  action: string;
  metadata?: Record<string, any>;
}

export interface UsageLimit {
  feature: string;
  limit: number;
  current: number;
  remaining: number;
  resetDate?: Date;
}

export interface UsageStats {
  accounts: UsageLimit;
  transactions: UsageLimit;
  categories: UsageLimit;
  budgets: UsageLimit;
  goals: UsageLimit;
}

export class UsageService {
  async trackUsage(data: UsageData) {
    try {
      const { userId, feature, action, metadata = {} } = data;

      // Create usage tracking record
      const usage = await prisma.usageTracking.create({
        data: {
          userId,
          feature,
          action,
          timestamp: new Date(),
          metadata,
        },
      });

      logger.info(`Usage tracked for user ${userId}: ${feature}.${action}`);
      return usage;
    } catch (error) {
      logger.error('Error tracking usage:', error);
      throw new AppError('Failed to track usage', 500);
    }
  }

  async getUserUsageStats(userId: string): Promise<UsageStats> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { currentPlan: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const planConfig = getPlanConfig(user.currentPlan);

      // Get current usage counts
      const [accountsCount, transactionsCount, categoriesCount, budgetsCount, goalsCount] =
        await Promise.all([
          prisma.account.count({ where: { userId } }),
          prisma.transaction.count({ where: { account: { userId } } }),
          prisma.category.count({ where: { userId } }),
          prisma.budget.count({ where: { userId } }),
          prisma.goal.count({ where: { userId } }),
        ]);

      // Calculate usage limits and remaining
      const createUsageLimit = (current: number, max: number): UsageLimit => ({
        feature: '',
        limit: max,
        current,
        remaining: max === -1 ? -1 : Math.max(0, max - current),
      });

      return {
        accounts: {
          ...createUsageLimit(accountsCount, planConfig.features.maxAccounts),
          feature: 'accounts',
        },
        transactions: {
          ...createUsageLimit(transactionsCount, planConfig.features.maxTransactions),
          feature: 'transactions',
        },
        categories: {
          ...createUsageLimit(categoriesCount, planConfig.features.maxCategories),
          feature: 'categories',
        },
        budgets: {
          ...createUsageLimit(budgetsCount, planConfig.features.maxBudgets),
          feature: 'budgets',
        },
        goals: {
          ...createUsageLimit(goalsCount, planConfig.features.maxGoals),
          feature: 'goals',
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error getting usage stats:', error);
      throw new AppError('Failed to get usage stats', 500);
    }
  }

  async checkFeatureLimit(
    userId: string,
    feature: string
  ): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    remaining: number;
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { currentPlan: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const planConfig = getPlanConfig(user.currentPlan);

      // Get limit for the feature
      let limit: number;
      let current: number;

      switch (feature) {
        case 'accounts':
          limit = planConfig.features.maxAccounts;
          current = await prisma.account.count({ where: { userId } });
          break;
        case 'transactions':
          limit = planConfig.features.maxTransactions;
          current = await prisma.transaction.count({ where: { account: { userId } } });
          break;
        case 'categories':
          limit = planConfig.features.maxCategories;
          current = await prisma.category.count({ where: { userId } });
          break;
        case 'budgets':
          limit = planConfig.features.maxBudgets;
          current = await prisma.budget.count({ where: { userId } });
          break;
        case 'goals':
          limit = planConfig.features.maxGoals;
          current = await prisma.goal.count({ where: { userId } });
          break;
        default:
          throw new AppError('Unknown feature', 400);
      }

      const allowed = limit === -1 || current < limit;
      const remaining = limit === -1 ? -1 : Math.max(0, limit - current);

      return {
        allowed,
        current,
        limit,
        remaining,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error checking feature limit:', error);
      throw new AppError('Failed to check feature limit', 500);
    }
  }

  async getUsageHistory(userId: string, feature?: string, limit: number = 100) {
    try {
      const whereClause: any = { userId };
      if (feature) {
        whereClause.feature = feature;
      }

      const usage = await prisma.usageTracking.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return usage;
    } catch (error) {
      logger.error('Error getting usage history:', error);
      throw new AppError('Failed to get usage history', 500);
    }
  }

  async getFeatureUsageTrends(userId: string, feature: string, days: number = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const usage = await prisma.usageTracking.findMany({
        where: {
          userId,
          feature,
          timestamp: {
            gte: startDate,
          },
        },
        orderBy: { timestamp: 'asc' },
      });

      // Group usage by day
      const usageByDay = usage.reduce(
        (acc, record) => {
          const day = record.timestamp.toISOString().split('T')[0];
          if (day && !acc[day]) {
            acc[day] = 0;
          }
          if (day) {
            acc[day] = (acc[day] || 0) + 1;
          }
          return acc;
        },
        {} as Record<string, number>
      );

      // Fill in missing days with 0
      const result = [];
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayKey = date.toISOString().split('T')[0];
        result.unshift({
          date: dayKey,
          usage: dayKey ? usageByDay[dayKey] || 0 : 0,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error getting usage trends:', error);
      throw new AppError('Failed to get usage trends', 500);
    }
  }

  async resetMonthlyUsage(userId?: string) {
    try {
      const whereClause: any = {};
      if (userId) {
        whereClause.userId = userId;
      }

      // For features that have monthly resets (if any)
      // Currently, our limits are not time-based, but this could be extended
      // to support monthly transaction limits, etc.

      logger.info(`Monthly usage reset${userId ? ` for user ${userId}` : ' for all users'}`);
    } catch (error) {
      logger.error('Error resetting monthly usage:', error);
      throw new AppError('Failed to reset monthly usage', 500);
    }
  }

  async generateUsageReport(userId: string) {
    try {
      const usageStats = await this.getUserUsageStats(userId);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { currentPlan: true, email: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const report = {
        user: {
          id: userId,
          email: user.email,
          currentPlan: user.currentPlan,
        },
        reportDate: new Date(),
        usage: usageStats,
        warnings: [] as string[],
        recommendations: [] as string[],
      };

      // Add warnings for usage approaching limits
      Object.values(usageStats).forEach((limit) => {
        if (limit.limit !== -1 && limit.remaining <= Math.ceil(limit.limit * 0.1)) {
          report.warnings.push(
            `You are approaching the limit for ${limit.feature} (${limit.current}/${limit.limit})`
          );
        }
      });

      // Add recommendations based on usage patterns
      const highUsageFeatures = Object.values(usageStats).filter(
        (limit) => limit.limit !== -1 && limit.current >= Math.ceil(limit.limit * 0.8)
      );

      if (highUsageFeatures.length > 0 && user.currentPlan === 'FREE') {
        report.recommendations.push('Consider upgrading to Pro plan for higher limits');
      } else if (highUsageFeatures.length > 1 && user.currentPlan === 'PRO') {
        report.recommendations.push('Consider upgrading to Ultimate plan for unlimited access');
      }

      return report;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error generating usage report:', error);
      throw new AppError('Failed to generate usage report', 500);
    }
  }
}

export const usageService = new UsageService();
