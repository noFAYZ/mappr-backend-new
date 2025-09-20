import { PlanType } from '@prisma/client';
import { getPlanFeatures, getFeatureLimit } from '@/config/plans';
import { prisma } from '@/config/database';

export interface LimitCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  remaining: number;
  planType: PlanType;
  feature: string;
}

export interface LimitError extends Error {
  code: string;
  statusCode: number;
  details: {
    feature: string;
    currentCount: number;
    limit: number;
    planType: PlanType;
    upgradeRequired: boolean;
  };
}

export class PlanLimitsService {
  async checkWalletLimit(userId: string): Promise<LimitCheckResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            cryptoWallets: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const currentCount = user._count.cryptoWallets;
    const limit = getFeatureLimit(user.currentPlan, 'maxWallets');
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - currentCount);
    const allowed = currentCount < limit;

    return {
      allowed,
      currentCount,
      limit: limit === Infinity ? -1 : limit,
      remaining: remaining === Infinity ? -1 : remaining,
      planType: user.currentPlan,
      feature: 'maxWallets',
    };
  }

  async checkAccountLimit(userId: string): Promise<LimitCheckResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            financialAccounts: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const currentCount = user._count.financialAccounts;
    const limit = getFeatureLimit(user.currentPlan, 'maxAccounts');
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - currentCount);
    const allowed = currentCount < limit;

    return {
      allowed,
      currentCount,
      limit: limit === Infinity ? -1 : limit,
      remaining: remaining === Infinity ? -1 : remaining,
      planType: user.currentPlan,
      feature: 'maxAccounts',
    };
  }

  async enforceWalletLimit(userId: string): Promise<void> {
    const result = await this.checkWalletLimit(userId);

    if (!result.allowed) {
      const error = new Error(
        `Wallet limit exceeded. Current plan allows ${result.limit} wallets.`
      ) as LimitError;
      error.code = 'WALLET_LIMIT_EXCEEDED';
      error.statusCode = 403;
      error.details = {
        feature: 'maxWallets',
        currentCount: result.currentCount,
        limit: result.limit,
        planType: result.planType,
        upgradeRequired: true,
      };
      throw error;
    }
  }

  async enforceAccountLimit(userId: string): Promise<void> {
    const result = await this.checkAccountLimit(userId);

    if (!result.allowed) {
      const error = new Error(
        `Account limit exceeded. Current plan allows ${result.limit} accounts.`
      ) as LimitError;
      error.code = 'ACCOUNT_LIMIT_EXCEEDED';
      error.statusCode = 403;
      error.details = {
        feature: 'maxAccounts',
        currentCount: result.currentCount,
        limit: result.limit,
        planType: result.planType,
        upgradeRequired: true,
      };
      throw error;
    }
  }

  async getUserLimitsOverview(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            cryptoWallets: true,
            financialAccounts: true,
            transactions: true,
            categories: true,
            budgets: true,
            goals: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const features = getPlanFeatures(user.currentPlan);

    return {
      planType: user.currentPlan,
      limits: {
        wallets: {
          current: user._count.cryptoWallets,
          limit: features.maxWallets === -1 ? -1 : features.maxWallets,
          remaining:
            features.maxWallets === -1
              ? -1
              : Math.max(0, features.maxWallets - user._count.cryptoWallets),
          percentage:
            features.maxWallets === -1
              ? 0
              : Math.round((user._count.cryptoWallets / features.maxWallets) * 100),
        },
        accounts: {
          current: user._count.financialAccounts,
          limit: features.maxAccounts === -1 ? -1 : features.maxAccounts,
          remaining:
            features.maxAccounts === -1
              ? -1
              : Math.max(0, features.maxAccounts - user._count.financialAccounts),
          percentage:
            features.maxAccounts === -1
              ? 0
              : Math.round((user._count.financialAccounts / features.maxAccounts) * 100),
        },
        transactions: {
          current: user._count.transactions,
          limit: features.maxTransactions === -1 ? -1 : features.maxTransactions,
          remaining:
            features.maxTransactions === -1
              ? -1
              : Math.max(0, features.maxTransactions - user._count.transactions),
          percentage:
            features.maxTransactions === -1
              ? 0
              : Math.round((user._count.transactions / features.maxTransactions) * 100),
        },
        categories: {
          current: user._count.categories,
          limit: features.maxCategories === -1 ? -1 : features.maxCategories,
          remaining:
            features.maxCategories === -1
              ? -1
              : Math.max(0, features.maxCategories - user._count.categories),
          percentage:
            features.maxCategories === -1
              ? 0
              : Math.round((user._count.categories / features.maxCategories) * 100),
        },
        budgets: {
          current: user._count.budgets,
          limit: features.maxBudgets === -1 ? -1 : features.maxBudgets,
          remaining:
            features.maxBudgets === -1
              ? -1
              : Math.max(0, features.maxBudgets - user._count.budgets),
          percentage:
            features.maxBudgets === -1
              ? 0
              : Math.round((user._count.budgets / features.maxBudgets) * 100),
        },
        goals: {
          current: user._count.goals,
          limit: features.maxGoals === -1 ? -1 : features.maxGoals,
          remaining:
            features.maxGoals === -1 ? -1 : Math.max(0, features.maxGoals - user._count.goals),
          percentage:
            features.maxGoals === -1
              ? 0
              : Math.round((user._count.goals / features.maxGoals) * 100),
        },
      },
    };
  }
}

export const planLimitsService = new PlanLimitsService();
