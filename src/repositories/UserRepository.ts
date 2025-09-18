import { PrismaClient, User, UserRole, UserStatus } from '@prisma/client';
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { logger } from '@/utils/logger';

export interface UserFilters {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
  hasSubscription?: boolean;
  lastLoginAfter?: Date;
  lastLoginBefore?: Date;
}

export interface UserWithStats extends User {
  stats: {
    walletCount: number;
    totalPortfolioValue: number;
    lastActivity: Date | null;
    subscriptionStatus: string | null;
    usageCount: number;
  };
}

export interface UserAnalytics {
  totalUsers: number;
  activeUsers: number;
  newUsersThisMonth: number;
  roleDistribution: Array<{
    role: UserRole;
    count: number;
    percentage: number;
  }>;
  statusDistribution: Array<{
    status: UserStatus;
    count: number;
    percentage: number;
  }>;
  subscriptionStats: {
    totalSubscribers: number;
    activeSubscribers: number;
    churnRate: number;
  };
  engagementMetrics: {
    dailyActiveUsers: number;
    weeklyActiveUsers: number;
    monthlyActiveUsers: number;
    averageSessionTime: number;
  };
}

export class UserRepository extends BaseRepository<User> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'user');
  }

  /**
   * Find user by email with case-insensitive search
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.executeWithMetrics(
      'findByEmail',
      async () => {
        return this.prisma.user.findFirst({
          where: {
            email: {
              equals: email,
              mode: 'insensitive',
            },
          },
        });
      },
      { email: email.split('@')[0] + '@***' }
    );
  }

  /**
   * Find users with advanced filtering
   */
  async findUsers(
    filters: UserFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 50 }
  ): Promise<PaginatedResult<UserWithStats>> {
    const where: any = {
      ...(filters.role && { role: filters.role }),
      ...(filters.status && { status: filters.status }),
    };

    // Date range filters
    if (filters.lastLoginAfter || filters.lastLoginBefore) {
      where.lastLoginAt = {};
      if (filters.lastLoginAfter) where.lastLoginAt.gte = filters.lastLoginAfter;
      if (filters.lastLoginBefore) where.lastLoginAt.lte = filters.lastLoginBefore;
    }

    // Search filter
    if (filters.search) {
      where.OR = [
        { email: { contains: filters.search, mode: 'insensitive' } },
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Subscription filter
    if (filters.hasSubscription !== undefined) {
      if (filters.hasSubscription) {
        where.subscriptions = { some: { status: 'ACTIVE' } };
      } else {
        where.subscriptions = { none: { status: 'ACTIVE' } };
      }
    }

    return this.executeWithMetrics(
      'findUsers',
      async () => {
        const { page, limit, orderBy = { createdAt: 'desc' } } = pagination;
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
          this.prisma.user.findMany({
            where,
            include: {
              _count: {
                select: {
                  cryptoWallets: {
                    where: { isActive: true },
                  },
                  usageTracking: true,
                },
              },
              subscription: {
                select: {
                  status: true,
                  planType: true,
                },
              },
              cryptoWallets: {
                where: { isActive: true },
                select: {
                  totalBalanceUsd: true,
                },
              },
              usageTracking: {
                select: {
                  timestamp: true,
                },
                orderBy: {
                  timestamp: 'desc',
                },
                take: 1,
              },
            },
            orderBy,
            skip,
            take: limit,
          }),
          this.prisma.user.count({ where }),
        ]);

        // Transform to include stats
        const usersWithStats: UserWithStats[] = users.map((user: any) => ({
          ...user,
          stats: {
            walletCount: user._count?.cryptoWallets || 0,
            totalPortfolioValue: user.cryptoWallets?.reduce(
              (sum: number, wallet: any) => sum + (wallet.totalBalanceUsd?.toNumber() || 0),
              0
            ) || 0,
            lastActivity: user.usageTracking?.[0]?.timestamp || null,
            subscriptionStatus: user.subscription?.status || null,
            usageCount: user._count?.usageTracking || 0,
          },
        }));

        const pages = Math.ceil(total / limit);

        return {
          data: usersWithStats,
          pagination: {
            page,
            limit,
            total,
            pages,
            hasNext: page < pages,
            hasPrev: page > 1,
          },
        };
      },
      { filters, pagination }
    );
  }

  /**
   * Get comprehensive user analytics
   */
  async getUserAnalytics(days = 30): Promise<UserAnalytics> {
    return this.executeWithMetrics(
      'getUserAnalytics',
      async () => {
        // const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // Basic user counts
        const [
          totalUsers,
          activeUsers,
          newUsersThisMonth,
          roleStats,
          statusStats,
          subscriptionStats,
          dailyActiveUsers,
          weeklyActiveUsers,
          monthlyActiveUsers,
        ] = await Promise.all([
          // Total users
          this.prisma.user.count(),

          // Active users (logged in within last 30 days)
          this.prisma.user.count({
            where: {
              lastLoginAt: { gte: monthAgo },
            },
          }),

          // New users this month
          this.prisma.user.count({
            where: {
              createdAt: { gte: monthAgo },
            },
          }),

          // Role distribution
          this.prisma.user.groupBy({
            by: ['role'],
            _count: true,
          }),

          // Status distribution
          this.prisma.user.groupBy({
            by: ['status'],
            _count: true,
          }),

          // Subscription stats
          Promise.all([
            this.prisma.subscription.count({
              where: { status: 'ACTIVE' },
            }),
            this.prisma.subscription.count(),
          ]),

          // Daily active users
          this.prisma.usageTracking.groupBy({
            by: ['userId'],
            where: {
              timestamp: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
              },
            },
            _count: true,
          }),

          // Weekly active users
          this.prisma.usageTracking.groupBy({
            by: ['userId'],
            where: {
              timestamp: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
              },
            },
            _count: true,
          }),

          // Monthly active users
          this.prisma.usageTracking.groupBy({
            by: ['userId'],
            where: {
              timestamp: { gte: monthAgo },
            },
            _count: true,
          }),
        ]);

        // Calculate role distribution
        const roleDistribution = roleStats.map((stat) => ({
          role: stat.role,
          count: stat._count,
          percentage: totalUsers > 0 ? (stat._count / totalUsers) * 100 : 0,
        }));

        // Calculate status distribution
        const statusDistribution = statusStats.map((stat) => ({
          status: stat.status,
          count: stat._count,
          percentage: totalUsers > 0 ? (stat._count / totalUsers) * 100 : 0,
        }));

        // Subscription metrics
        const [totalSubscribers, activeSubscribers] = subscriptionStats;
        const churnRate =
          totalSubscribers > 0
            ? ((totalSubscribers - activeSubscribers) / totalSubscribers) * 100
            : 0;

        return {
          totalUsers,
          activeUsers,
          newUsersThisMonth,
          roleDistribution,
          statusDistribution,
          subscriptionStats: {
            totalSubscribers,
            activeSubscribers,
            churnRate,
          },
          engagementMetrics: {
            dailyActiveUsers: dailyActiveUsers.length,
            weeklyActiveUsers: weeklyActiveUsers.length,
            monthlyActiveUsers: monthlyActiveUsers.length,
            averageSessionTime: 0, // Would need session tracking to implement
          },
        };
      },
      { days }
    );
  }

  /**
   * Update user last login timestamp
   */
  async updateLastLogin(userId: string): Promise<User> {
    return this.executeWithMetrics(
      'updateLastLogin',
      async () => {
        return this.prisma.user.update({
          where: { id: userId },
          data: {
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          },
        });
      },
      { userId }
    );
  }

  /**
   * Get user profile with complete information
   */
  async getUserProfile(userId: string): Promise<UserWithStats | null> {
    return this.executeWithMetrics(
      'getUserProfile',
      async () => {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          include: {
            _count: {
              select: {
                cryptoWallets: {
                  where: { isActive: true },
                },
                usageTracking: true,
              },
            },
            subscription: {
              select: {
                status: true,
                planType: true,
              },
            },
            cryptoWallets: {
              where: { isActive: true },
              select: {
                totalBalanceUsd: true,
              },
            },
            usageTracking: {
              select: {
                timestamp: true,
              },
              orderBy: {
                timestamp: 'desc',
              },
              take: 1,
            },
          },
        });

        if (!user) return null;

        const userWithStats = user as any;
        return {
          ...user,
          stats: {
            walletCount: userWithStats._count?.cryptoWallets || 0,
            totalPortfolioValue: userWithStats.cryptoWallets?.reduce(
              (sum: number, wallet: any) => sum + (wallet.totalBalanceUsd?.toNumber() || 0),
              0
            ) || 0,
            lastActivity: userWithStats.usageTracking?.[0]?.timestamp || null,
            subscriptionStatus: userWithStats.subscription?.status || null,
            usageCount: userWithStats._count?.usageTracking || 0,
          },
        };
      },
      { userId }
    );
  }

  /**
   * Search users by email or name
   */
  async searchUsers(
    query: string,
    limit = 10
  ): Promise<Array<Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'role'>>> {
    return this.executeWithMetrics(
      'searchUsers',
      async () => {
        return this.prisma.user.findMany({
          where: {
            OR: [
              { email: { contains: query, mode: 'insensitive' } },
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
            ],
            status: 'ACTIVE', // Only search active users
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        });
      },
      { query: query.substring(0, 10) + '...', limit }
    );
  }

  /**
   * Get users who haven't logged in for a specified period
   */
  async getInactiveUsers(
    daysInactive = 90,
    pagination: PaginationOptions = { page: 1, limit: 50 }
  ): Promise<PaginatedResult<User>> {
    return this.executeWithMetrics(
      'getInactiveUsers',
      async () => {
        const cutoffDate = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000);

        const where = {
          OR: [{ lastLoginAt: { lt: cutoffDate } }, { lastLoginAt: null }],
          status: 'ACTIVE', // Only active users who haven't logged in
        };

        return this.findManyPaginated({
          where,
          orderBy: { lastLoginAt: 'asc' },
          ...pagination,
        });
      },
      { daysInactive, pagination }
    );
  }

  /**
   * Update user profile information
   */
  async updateProfile(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      timezone?: string;
      language?: string;
      preferences?: Record<string, any>;
    }
  ): Promise<User> {
    return this.executeWithMetrics(
      'updateProfile',
      async () => {
        return this.prisma.user.update({
          where: { id: userId },
          data: {
            ...data,
            updatedAt: new Date(),
          },
        });
      },
      { userId, updateFields: Object.keys(data) }
    );
  }

  /**
   * Get top users by portfolio value
   */
  async getTopUsersByPortfolioValue(limit = 10): Promise<
    Array<{
      userId: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      totalPortfolioValue: number;
      walletCount: number;
    }>
  > {
    return this.executeWithMetrics(
      'getTopUsersByPortfolioValue',
      async () => {
        const result = await this.prisma.user.findMany({
          where: {
            status: 'ACTIVE',
            cryptoWallets: {
              some: {
                isActive: true,
                totalBalanceUsd: { gt: 0 },
              },
            },
          },
          include: {
            _count: {
              select: {
                cryptoWallets: {
                  where: { isActive: true },
                },
              },
            },
            cryptoWallets: {
              where: { isActive: true },
              select: {
                totalBalanceUsd: true,
              },
            },
          },
          take: limit * 2, // Get more than needed for sorting
        });

        // Calculate total portfolio values and sort
        const usersWithValues = result
          .map((user) => ({
            userId: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            totalPortfolioValue: user.cryptoWallets.reduce(
              (sum, wallet) => sum + wallet.totalBalanceUsd.toNumber(),
              0
            ),
            walletCount: user._count.cryptoWallets,
          }))
          .filter((user) => user.totalPortfolioValue > 0)
          .sort((a, b) => b.totalPortfolioValue - a.totalPortfolioValue)
          .slice(0, limit);

        return usersWithValues;
      },
      { limit }
    );
  }

  /**
   * Ban or suspend a user
   */
  async updateUserStatus(userId: string, status: UserStatus, reason?: string): Promise<User> {
    return this.executeWithMetrics(
      'updateUserStatus',
      async () => {
        const user = await this.prisma.user.update({
          where: { id: userId },
          data: {
            status,
            updatedAt: new Date(),
          },
        });

        // Log the status change
        logger.warn('User status changed', {
          userId,
          newStatus: status,
          reason,
          timestamp: new Date(),
        });

        return user;
      },
      { userId, status, reason }
    );
  }

  /**
   * Clean up old unverified users
   */
  async cleanupUnverifiedUsers(daysOld = 7): Promise<number> {
    return this.executeWithMetrics(
      'cleanupUnverifiedUsers',
      async () => {
        const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

        const result = await this.prisma.user.deleteMany({
          where: {
            status: 'PENDING_VERIFICATION',
            createdAt: { lt: cutoffDate },
            cryptoWallets: { none: {} }, // Only delete users with no wallets
            subscription: null, // Only delete users with no subscription
          },
        });

        logger.info('Cleaned up unverified users', {
          deletedCount: result.count,
          cutoffDate,
        });

        return result.count;
      },
      { daysOld }
    );
  }

  /**
   * Get user activity summary
   */
  async getUserActivity(
    userId: string,
    days = 30
  ): Promise<{
    totalActions: number;
    uniqueDays: number;
    mostUsedFeatures: Array<{
      feature: string;
      count: number;
    }>;
    activityByDay: Array<{
      date: Date;
      actionCount: number;
    }>;
  }> {
    if (!userId) {
      throw new Error('userId is required for getUserActivity');
    }
    return this.executeWithMetrics(
      'getUserActivity',
      async () => {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const activities = await this.prisma.usageTracking.findMany({
          where: {
            userId,
            timestamp: { gte: cutoffDate },
          },
          select: {
            feature: true,
            action: true,
            timestamp: true,
          },
          orderBy: { timestamp: 'desc' },
        });

        const totalActions = activities.length;

        // Unique days with activity
        const uniqueDays = new Set(activities.map((a) => a.timestamp.toISOString().split('T')[0]))
          .size;

        // Most used features
        const featureMap = new Map<string, number>();
        activities.forEach((activity) => {
          featureMap.set(activity.feature, (featureMap.get(activity.feature) || 0) + 1);
        });

        const mostUsedFeatures = Array.from(featureMap.entries())
          .map(([feature, count]) => ({ feature, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        // Activity by day
        const dailyMap = new Map<string, number>();
        activities.forEach((activity) => {
          const dateKey = activity.timestamp.toISOString().split('T')[0];
          dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + 1);
        });

        const activityByDay = Array.from(dailyMap.entries())
          .map(([dateStr, count]) => ({
            date: new Date(dateStr),
            actionCount: count,
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());

        return {
          totalActions,
          uniqueDays,
          mostUsedFeatures,
          activityByDay,
        };
      },
      { userId, days }
    );
  }
}
