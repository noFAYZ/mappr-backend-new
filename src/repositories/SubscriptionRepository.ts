import { PrismaClient, Subscription, SubscriptionStatus, PlanType } from '@prisma/client';
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { logger } from '@/utils/logger';

export interface SubscriptionFilters {
  userId?: string;
  status?: SubscriptionStatus;
  plan?: PlanType;
  expiringWithinDays?: number;
  search?: string;
}

export interface SubscriptionWithUser extends Subscription {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  payments: Array<{
    id: string;
    amount: number;
    status: string;
    paymentDate: Date;
  }>;
}

export interface SubscriptionAnalytics {
  totalSubscriptions: number;
  activeSubscriptions: number;
  revenue: {
    monthly: number;
    yearly: number;
    lifetime: number;
  };
  planDistribution: Array<{
    plan: PlanType;
    count: number;
    percentage: number;
    revenue: number;
  }>;
  churnAnalysis: {
    churnRate: number;
    cancelledThisMonth: number;
    newThisMonth: number;
    netGrowth: number;
  };
  expiringSubscriptions: {
    next7Days: number;
    next30Days: number;
  };
}

export class SubscriptionRepository extends BaseRepository<Subscription> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'subscription');
  }

  /**
   * Find subscriptions with advanced filtering
   */
  async findSubscriptions(
    filters: SubscriptionFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 50 }
  ): Promise<PaginatedResult<SubscriptionWithUser>> {
    const where: any = {
      ...(filters.userId && { userId: filters.userId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.plan && { planType: filters.plan }),
    };

    // Expiring subscriptions filter
    if (filters.expiringWithinDays) {
      const expiryDate = new Date(Date.now() + filters.expiringWithinDays * 24 * 60 * 60 * 1000);
      where.endDate = {
        lte: expiryDate,
        gte: new Date(), // Not already expired
      };
      where.status = 'ACTIVE'; // Only active subscriptions can expire
    }

    // Search filter
    if (filters.search) {
      where.user = {
        OR: [
          { email: { contains: filters.search, mode: 'insensitive' } },
          { firstName: { contains: filters.search, mode: 'insensitive' } },
          { lastName: { contains: filters.search, mode: 'insensitive' } },
        ],
      };
    }

    return this.executeWithMetrics(
      'findSubscriptions',
      async () => {
        const { page, limit, orderBy = { createdAt: 'desc' } } = pagination;
        const skip = (page - 1) * limit;

        const [subscriptions, total] = await Promise.all([
          this.prisma.subscription.findMany({
            where,
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
              payments: {
                select: {
                  id: true,
                  amount: true,
                  status: true,
                  paymentDate: true,
                },
                orderBy: { paymentDate: 'desc' },
                take: 3, // Last 3 payments
              },
            },
            orderBy,
            skip,
            take: limit,
          }),
          this.prisma.subscription.count({ where }),
        ]);

        const pages = Math.ceil(total / limit);

        return {
          data: subscriptions as SubscriptionWithUser[],
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
   * Get user's active subscription
   */
  async getUserActiveSubscription(userId: string): Promise<Subscription | null> {
    return this.executeWithMetrics(
      'getUserActiveSubscription',
      async () => {
        return this.prisma.subscription.findFirst({
          where: {
            userId,
            status: 'ACTIVE',
            endDate: { gt: new Date() },
          },
          orderBy: { endDate: 'desc' },
        });
      },
      { userId }
    );
  }

  /**
   * Get comprehensive subscription analytics
   */
  async getSubscriptionAnalytics(days = 30): Promise<SubscriptionAnalytics> {
    return this.executeWithMetrics(
      'getSubscriptionAnalytics',
      async () => {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const now = new Date();

        const [
          totalSubscriptions,
          activeSubscriptions,
          planStats,
          revenueStats,
          churnStats,
          expiringStats,
        ] = await Promise.all([
          // Total subscriptions
          this.prisma.subscription.count(),

          // Active subscriptions
          this.prisma.subscription.count({
            where: {
              status: 'ACTIVE',
              endDate: { gt: now },
            },
          }),

          // Plan distribution
          this.prisma.subscription.groupBy({
            by: ['planType'],
            where: { status: 'ACTIVE' },
            _count: true,
          }),

          // Revenue calculation
          this.prisma.payment.aggregate({
            where: {
              status: 'SUCCEEDED',
              paymentDate: { gte: cutoffDate },
            },
            _sum: { amount: true },
          }),

          // Churn analysis
          Promise.all([
            this.prisma.subscription.count({
              where: {
                status: 'CANCELLED',
                updatedAt: { gte: cutoffDate },
              },
            }),
            this.prisma.subscription.count({
              where: {
                createdAt: { gte: cutoffDate },
              },
            }),
          ]),

          // Expiring subscriptions
          Promise.all([
            this.prisma.subscription.count({
              where: {
                status: 'ACTIVE',
                endDate: {
                  gte: now,
                  lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
              },
            }),
            this.prisma.subscription.count({
              where: {
                status: 'ACTIVE',
                endDate: {
                  gte: now,
                  lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
              },
            }),
          ]),
        ]);

        // Calculate plan distribution with revenue
        const planRevenue = await Promise.all(
          planStats.map(async (plan) => {
            const revenue = await this.prisma.payment.aggregate({
              where: {
                status: 'SUCCEEDED',
                subscription: {
                  planType: plan.planType,
                },
                paymentDate: { gte: cutoffDate },
              },
              _sum: { amount: true },
            });

            return {
              plan: plan.planType,
              count: plan._count,
              percentage: activeSubscriptions > 0 ? (plan._count / activeSubscriptions) * 100 : 0,
              revenue: revenue._sum.amount?.toNumber() || 0,
            };
          })
        );

        const [cancelledThisMonth, newThisMonth] = churnStats;
        const [next7Days, next30Days] = expiringStats;

        const monthlyRevenue = revenueStats._sum.amount?.toNumber() || 0;
        const churnRate =
          activeSubscriptions > 0 ? (cancelledThisMonth / activeSubscriptions) * 100 : 0;

        return {
          totalSubscriptions,
          activeSubscriptions,
          revenue: {
            monthly: monthlyRevenue,
            yearly: monthlyRevenue * 12, // Rough estimate
            lifetime: 0, // Would need historical data
          },
          planDistribution: planRevenue,
          churnAnalysis: {
            churnRate,
            cancelledThisMonth,
            newThisMonth,
            netGrowth: newThisMonth - cancelledThisMonth,
          },
          expiringSubscriptions: {
            next7Days,
            next30Days,
          },
        };
      },
      { days }
    );
  }

  /**
   * Create a new subscription
   */
  async createSubscription(data: {
    userId: string;
    plan: PlanType;
    startDate?: Date;
    endDate: Date;
    stripeSubscriptionId?: string;
    // Note: metadata is not in Subscription schema, use Payment.metadata instead
  }): Promise<Subscription> {
    return this.executeWithMetrics(
      'createSubscription',
      async () => {
        // Cancel any existing active subscription for this user
        await this.prisma.subscription.updateMany({
          where: {
            userId: data.userId,
            status: 'ACTIVE',
          },
          data: {
            status: 'CANCELLED',
            updatedAt: new Date(),
          },
        });

        // Create new subscription
        const subscription = await this.prisma.subscription.create({
          data: {
            userId: data.userId,
            planType: data.plan,
            status: 'ACTIVE',
            startDate: data.startDate || new Date(),
            endDate: data.endDate,
            stripeSubscriptionId: data.stripeSubscriptionId,
            // metadata removed - not in schema
          },
        });

        logger.info('New subscription created', {
          userId: data.userId,
          subscriptionId: subscription.id,
          plan: data.plan,
          endDate: data.endDate,
        });

        return subscription;
      },
      { userId: data.userId, planType: data.plan }
    );
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(
    subscriptionId: string,
    reason?: string,
    immediateCancel = false
  ): Promise<Subscription> {
    return this.executeWithMetrics(
      'cancelSubscription',
      async () => {
        const updateData: any = {
          status: 'CANCELLED' as SubscriptionStatus,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        };

        if (immediateCancel) {
          updateData.endDate = new Date(); // Expire immediately
        }

        if (reason) {
          updateData.metadata = {
            cancellationReason: reason,
          };
        }

        const subscription = await this.prisma.subscription.update({
          where: { id: subscriptionId },
          data: updateData,
        });

        logger.info('Subscription cancelled', {
          subscriptionId,
          userId: subscription.userId,
          reason,
          immediateCancel,
        });

        return subscription;
      },
      { subscriptionId, reason, immediateCancel }
    );
  }

  /**
   * Renew a subscription
   */
  async renewSubscription(subscriptionId: string, endDate: Date): Promise<Subscription> {
    return this.executeWithMetrics(
      'renewSubscription',
      async () => {
        const subscription = await this.prisma.subscription.update({
          where: { id: subscriptionId },
          data: {
            status: 'ACTIVE',
            endDate,
            updatedAt: new Date(),
          },
        });

        logger.info('Subscription renewed', {
          subscriptionId,
          userId: subscription.userId,
          newExpiresAt: endDate,
        });

        return subscription;
      },
      { subscriptionId, endDate }
    );
  }

  /**
   * Get subscriptions expiring soon
   */
  async getExpiringSubscriptions(daysAhead = 7, limit = 100): Promise<SubscriptionWithUser[]> {
    return this.executeWithMetrics(
      'getExpiringSubscriptions',
      async () => {
        const expiryDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

        return this.prisma.subscription.findMany({
          where: {
            status: 'ACTIVE',
            endDate: {
              gte: new Date(),
              lte: expiryDate,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
            payments: {
              select: {
                id: true,
                amount: true,
                status: true,
                paymentDate: true,
              },
              orderBy: { paymentDate: 'desc' },
              take: 1,
            },
          },
          orderBy: { endDate: 'asc' },
          take: limit,
        }) as Promise<SubscriptionWithUser[]>;
      },
      { daysAhead, limit }
    );
  }

  /**
   * Update subscription from Stripe webhook
   */
  async updateFromStripe(
    stripeSubscriptionId: string,
    data: {
      status?: SubscriptionStatus;
      currentPeriodEnd?: Date;
      cancelAtPeriodEnd?: boolean;
      metadata?: Record<string, any>;
    }
  ): Promise<Subscription | null> {
    return this.executeWithMetrics(
      'updateFromStripe',
      async () => {
        const subscription = await this.prisma.subscription.findFirst({
          where: { stripeSubscriptionId },
        });

        if (!subscription) {
          logger.warn('Subscription not found for Stripe ID', { stripeSubscriptionId });
          return null;
        }

        const updateData: any = {
          updatedAt: new Date(),
        };

        if (data.status) updateData.status = data.status;
        if (data.currentPeriodEnd) updateData.endDate = data.currentPeriodEnd;
        if (data.metadata) updateData.metadata = { ...subscription.metadata, ...data.metadata };

        const updatedSubscription = await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: updateData,
        });

        logger.info('Subscription updated from Stripe', {
          subscriptionId: subscription.id,
          stripeSubscriptionId,
          changes: data,
        });

        return updatedSubscription;
      },
      { stripeSubscriptionId, changes: Object.keys(data) }
    );
  }

  /**
   * Get subscription revenue trends
   */
  async getRevenueTrends(days = 90): Promise<
    Array<{
      date: Date;
      revenue: number;
      subscriptionCount: number;
      newSubscriptions: number;
    }>
  > {
    return this.executeWithMetrics(
      'getRevenueTrends',
      async () => {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // Get payment data
        const payments = await this.prisma.payment.findMany({
          where: {
            status: 'COMPLETED',
            paymentDate: { gte: cutoffDate },
          },
          select: {
            amount: true,
            paymentDate: true,
          },
          orderBy: { paymentDate: 'asc' },
        });

        // Get subscription creation data
        const subscriptions = await this.prisma.subscription.findMany({
          where: {
            createdAt: { gte: cutoffDate },
          },
          select: {
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        });

        // Group by day
        const dailyData = new Map<
          string,
          {
            revenue: number;
            subscriptionCount: number;
            newSubscriptions: number;
          }
        >();

        // Process payments
        payments.forEach((payment) => {
          const dateKey = payment.paymentDate.toISOString().split('T')[0];
          const existing = dailyData.get(dateKey) || {
            revenue: 0,
            subscriptionCount: 0,
            newSubscriptions: 0,
          };
          existing.revenue += payment.amount.toNumber();
          dailyData.set(dateKey, existing);
        });

        // Process new subscriptions
        subscriptions.forEach((subscription) => {
          const dateKey = subscription.createdAt.toISOString().split('T')[0];
          const existing = dailyData.get(dateKey) || {
            revenue: 0,
            subscriptionCount: 0,
            newSubscriptions: 0,
          };
          existing.newSubscriptions += 1;
          dailyData.set(dateKey, existing);
        });

        return Array.from(dailyData.entries())
          .map(([dateStr, data]) => ({
            date: new Date(dateStr),
            revenue: data.revenue,
            subscriptionCount: data.subscriptionCount,
            newSubscriptions: data.newSubscriptions,
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());
      },
      { days }
    );
  }

  /**
   * Expire subscriptions that are past their expiry date
   */
  async expireSubscriptions(): Promise<number> {
    return this.executeWithMetrics('expireSubscriptions', async () => {
      const result = await this.prisma.subscription.updateMany({
        where: {
          status: 'ACTIVE',
          endDate: { lt: new Date() },
        },
        data: {
          status: 'EXPIRED',
          updatedAt: new Date(),
        },
      });

      if (result.count > 0) {
        logger.info('Expired subscriptions', {
          count: result.count,
          timestamp: new Date(),
        });
      }

      return result.count;
    });
  }

  /**
   * Get subscription history for a user
   */
  async getUserSubscriptionHistory(
    userId: string,
    pagination: PaginationOptions = { page: 1, limit: 10 }
  ): Promise<PaginatedResult<Subscription>> {
    return this.executeWithMetrics(
      'getUserSubscriptionHistory',
      async () => {
        return this.findManyPaginated({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          ...pagination,
        });
      },
      { userId, pagination }
    );
  }

  /**
   * Check if user has active subscription with specific plan
   */
  async hasActivePlan(userId: string, plan: PlanType): Promise<boolean> {
    return this.executeWithMetrics(
      'hasActivePlan',
      async () => {
        const count = await this.prisma.subscription.count({
          where: {
            userId,
            planType: plan,
            status: 'ACTIVE',
            endDate: { gt: new Date() },
          },
        });

        return count > 0;
      },
      { userId, planType: plan }
    );
  }
}
