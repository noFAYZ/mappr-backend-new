import { Request, Response } from 'express';
import { prisma } from '@/config/database';
import { logger } from '@/utils/logger';
import { assertAuthenticatedUser } from '@/middleware/auth';
import { adminHelpers } from '@/utils/adminHelpers';
import { z } from 'zod';

export class AdminController {
  /**
   * Get dashboard overview statistics
   */
  async getDashboardStats(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      const [
        totalUsers,
        activeUsers,
        totalSubscriptions,
        totalRevenue,
        totalCryptoWallets,
        totalTransactions,
        newUsersThisMonth,
        activeSubscriptions,
      ] = await Promise.all([
        // Total users
        prisma.user.count(),

        // Active users (logged in within last 30 days)
        prisma.user.count({
          where: {
            lastLoginAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        }),

        // Total subscriptions
        prisma.subscription.count(),

        // Total revenue from successful payments
        prisma.payment.aggregate({
          where: { status: 'SUCCEEDED' },
          _sum: { amount: true },
        }),

        // Total crypto wallets
        prisma.cryptoWallet.count(),

        // Total transactions
        prisma.transaction.count(),

        // New users this month
        prisma.user.count({
          where: {
            createdAt: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
          },
        }),

        // Active subscriptions
        prisma.subscription.count({
          where: { status: 'ACTIVE' },
        }),
      ]);

      res.json({
        success: true,
        data: {
          users: {
            total: totalUsers,
            active: activeUsers,
            newThisMonth: newUsersThisMonth,
          },
          subscriptions: {
            total: totalSubscriptions,
            active: activeSubscriptions,
          },
          revenue: {
            total: totalRevenue._sum.amount || 0,
          },
          platform: {
            cryptoWallets: totalCryptoWallets,
            transactions: totalTransactions,
          },
        },
      });
    } catch (error: any) {
      logger.error('Admin dashboard stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard statistics',
        message: error.message,
      });
    }
  }

  /**
   * Get user analytics and trends
   */
  async getUserAnalytics(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      // User growth over the last 12 months
      const userGrowth = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', "createdAt") as month,
          COUNT(*)::int as count
        FROM users 
        WHERE "createdAt" >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY month DESC
      `;

      // User status breakdown
      const userStatusBreakdown = await prisma.user.groupBy({
        by: ['status'],
        _count: true,
      });

      // Plan distribution
      const planDistribution = await prisma.user.groupBy({
        by: ['currentPlan'],
        _count: true,
      });

      // User activity (last login distribution)
      const userActivity = await prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN "lastLoginAt" IS NULL THEN 'never'
            WHEN "lastLoginAt" >= CURRENT_DATE - INTERVAL '1 day' THEN 'today'
            WHEN "lastLoginAt" >= CURRENT_DATE - INTERVAL '7 days' THEN 'this_week'
            WHEN "lastLoginAt" >= CURRENT_DATE - INTERVAL '30 days' THEN 'this_month'
            ELSE 'inactive'
          END as activity_period,
          COUNT(*)::int as count
        FROM users
        GROUP BY activity_period
      `;

      res.json({
        success: true,
        data: {
          userGrowth,
          userStatusBreakdown,
          planDistribution,
          userActivity,
        },
      });
    } catch (error: any) {
      logger.error('Admin user analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user analytics',
        message: error.message,
      });
    }
  }

  /**
   * Get revenue and subscription analytics
   */
  async getRevenueAnalytics(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      // Monthly revenue for the last 12 months
      const monthlyRevenue = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', "paymentDate") as month,
          SUM(amount)::float as revenue,
          COUNT(*)::int as transactions
        FROM payments 
        WHERE status = 'SUCCEEDED' 
          AND "paymentDate" >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', "paymentDate")
        ORDER BY month DESC
      `;

      // Subscription analytics
      const subscriptionMetrics = await prisma.subscription.groupBy({
        by: ['status', 'billingPeriod'],
        _count: true,
        _avg: { amount: true },
      });

      // Churn analysis
      const churnData = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', "cancelAt") as month,
          COUNT(*)::int as churned_subscriptions
        FROM subscriptions 
        WHERE status = 'CANCELLED' 
          AND "cancelAt" >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', "cancelAt")
        ORDER BY month DESC
      `;

      res.json({
        success: true,
        data: {
          monthlyRevenue,
          subscriptionMetrics,
          churnData,
        },
      });
    } catch (error: any) {
      logger.error('Admin revenue analytics error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch revenue analytics',
        message: error.message,
      });
    }
  }

  /**
   * Get system health and performance metrics
   */
  async getSystemHealth(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      // Database health
      const dbHealthStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const dbResponseTime = Date.now() - dbHealthStart;

      // Usage statistics
      const [usageStats, errorLogs] = await Promise.all([
        prisma.usageTracking.count({
          where: {
            timestamp: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
            },
          },
        }),

        prisma.auditLog.count({
          where: {
            action: {
              contains: 'ERROR',
            },
            createdAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
            },
          },
        }),
      ]);

      // System metrics
      const systemMetrics = {
        database: {
          status: dbResponseTime < 1000 ? 'healthy' : 'slow',
          responseTime: dbResponseTime,
        },
        api: {
          requestsLast24h: usageStats,
          errorsLast24h: errorLogs,
        },
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version,
      };

      res.json({
        success: true,
        data: systemMetrics,
      });
    } catch (error: any) {
      logger.error('Admin system health error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch system health',
        message: error.message,
      });
    }
  }

  /**
   * Get all users with pagination and filtering
   */
  async getUsers(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 10));
      const offset = (page - 1) * limit;

      const status = req.query['status'] as string;
      const plan = req.query['plan'] as string;
      const search = req.query['search'] as string;

      // Build filter conditions
      const where: any = {};
      if (status) where.status = status;
      if (plan) where.currentPlan = plan;
      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [users, totalCount] = await Promise.all([
        prisma.user.findMany({
          skip: offset,
          take: limit,
          where,
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            currentPlan: true,
            emailVerified: true,
            createdAt: true,
            lastLoginAt: true,
            _count: {
              select: {
                cryptoWallets: true,
                transactions: true,
                financialAccounts: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        },
      });
    } catch (error: any) {
      logger.error('Admin get users error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch users',
        message: error.message,
      });
    }
  }

  /**
   * Update user details (admin only)
   */
  async updateUser(req: Request, res: Response) {
    try {
      const admin = assertAuthenticatedUser(req);
      const { userId } = req.params;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID is required',
        });
        return;
      }

      const updateSchema = z.object({
        status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION']).optional(),
        role: z.enum(['USER', 'ADMIN', 'PREMIUM']).optional(),
        currentPlan: z.enum(['FREE', 'PRO', 'ULTIMATE']).optional(),
        emailVerified: z.boolean().optional(),
      });

      const validatedData = updateSchema.parse(req.body);

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: Object.fromEntries(Object.entries(validatedData).filter(([_, v]) => v !== undefined)),
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          currentPlan: true,
          emailVerified: true,
          updatedAt: true,
        },
      });

      // Log the admin action
      await prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: 'ADMIN_USER_UPDATE',
          resource: 'user',
          resourceId: userId,
          details: {
            updatedFields: validatedData,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      logger.info(`Admin ${admin.email} updated user ${userId}`, { updatedFields: validatedData });

      res.json({
        success: true,
        data: { user: updatedUser },
        message: 'User updated successfully',
      });
    } catch (error: any) {
      logger.error('Admin update user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update user',
        message: error.message,
      });
    }
  }

  /**
   * Get platform usage statistics
   */
  async getUsageStats(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      const timeRange = (req.query['timeRange'] as string) || '7d';
      const days = timeRange === '1d' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 7;

      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Feature usage breakdown
      const featureUsage = await prisma.usageTracking.groupBy({
        by: ['feature'],
        where: { timestamp: { gte: since } },
        _count: { feature: true },
        orderBy: { _count: { feature: 'desc' } },
      });

      // Daily usage trends
      const dailyUsage = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('day', timestamp) as date,
          feature,
          COUNT(*)::int as usage_count
        FROM "UsageTracking"
        WHERE timestamp >= ${since}
        GROUP BY DATE_TRUNC('day', timestamp), feature
        ORDER BY date DESC, usage_count DESC
      `;

      // Top users by usage
      const topUsers = await prisma.$queryRaw`
        SELECT 
          u.email,
          u."firstName",
          u."lastName",
          COUNT(ut.*)::int as usage_count
        FROM "UsageTracking" ut
        JOIN users u ON ut."userId" = u.id
        WHERE ut.timestamp >= ${since}
        GROUP BY u.id, u.email, u."firstName", u."lastName"
        ORDER BY usage_count DESC
        LIMIT 10
      `;

      res.json({
        success: true,
        data: {
          featureUsage,
          dailyUsage,
          topUsers,
          timeRange,
        },
      });
    } catch (error: any) {
      logger.error('Admin usage stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch usage statistics',
        message: error.message,
      });
    }
  }

  /**
   * Get audit logs for admin actions
   */
  async getAuditLogs(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 20));
      const offset = (page - 1) * limit;

      const action = req.query['action'] as string;
      const resource = req.query['resource'] as string;

      const where: any = {};
      if (action) where.action = { contains: action };
      if (resource) where.resource = resource;

      const [logs, totalCount] = await Promise.all([
        prisma.auditLog.findMany({
          skip: offset,
          take: limit,
          where,
          include: {
            user: {
              select: {
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        },
      });
    } catch (error: any) {
      logger.error('Admin audit logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch audit logs',
        message: error.message,
      });
    }
  }

  /**
   * Generate system report
   */
  async generateReport(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      const { startDate, endDate } = req.query;
      const start = startDate
        ? new Date(startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const report = await adminHelpers.generateReport(start, end);

      res.json({
        success: true,
        data: report,
      });
    } catch (error: any) {
      logger.error('Admin generate report error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate report',
        message: error.message,
      });
    }
  }

  /**
   * Get system alerts
   */
  async getSystemAlerts(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      const alerts = await adminHelpers.getSystemAlerts();

      res.json({
        success: true,
        data: { alerts },
      });
    } catch (error: any) {
      logger.error('Admin system alerts error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch system alerts',
        message: error.message,
      });
    }
  }

  /**
   * Perform system maintenance
   */
  async performMaintenance(req: Request, res: Response) {
    try {
      const admin = assertAuthenticatedUser(req);

      await adminHelpers.validateAdminPermissions(admin.id, 'SYSTEM_MAINTENANCE');

      const results = await adminHelpers.performMaintenance();

      res.json({
        success: true,
        data: results,
        message: 'System maintenance completed successfully',
      });
    } catch (error: any) {
      logger.error('Admin system maintenance error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to perform system maintenance',
        message: error.message,
      });
    }
  }

  /**
   * Get platform statistics overview
   */
  async getPlatformStats(req: Request, res: Response) {
    try {
      assertAuthenticatedUser(req);

      const stats = await adminHelpers.getPlatformStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      logger.error('Admin platform stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch platform statistics',
        message: error.message,
      });
    }
  }
}

export const adminController = new AdminController();
