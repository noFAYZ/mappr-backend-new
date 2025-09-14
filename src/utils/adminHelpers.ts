import { prisma } from '@/config/database';
import { logger } from '@/utils/logger';

export class AdminHelpers {
  /**
   * Create a system admin user (for initial setup)
   */
  static async createSystemAdmin(
    email: string,
    _password: string,
    firstName: string,
    lastName: string
  ) {
    try {
      const admin = await prisma.user.create({
        data: {
          email,
          firstName,
          lastName,
          role: 'ADMIN',
          status: 'ACTIVE',
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });

      // Log the admin creation
      await prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: 'SYSTEM_ADMIN_CREATED',
          resource: 'user',
          resourceId: admin.id,
          details: {
            email: admin.email,
            role: admin.role,
            createdBy: 'SYSTEM',
          },
        },
      });

      logger.info(`System admin created: ${email}`);
      return admin;
    } catch (error: any) {
      logger.error('Failed to create system admin:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive platform statistics
   */
  static async getPlatformStats() {
    try {
      const [userStats, subscriptionStats, revenueStats, cryptoStats, transactionStats] =
        await Promise.all([
          prisma.user.groupBy({
            by: ['status', 'currentPlan'],
            _count: true,
          }),

          prisma.subscription.groupBy({
            by: ['status'],
            _count: true,
            _sum: { amount: true },
          }),

          prisma.payment.aggregate({
            where: { status: 'SUCCEEDED' },
            _sum: { amount: true },
            _count: true,
          }),

          prisma.cryptoWallet.count(),

          prisma.transaction.count(),
        ]);

      return {
        users: userStats,
        subscriptions: subscriptionStats,
        revenue: revenueStats,
        crypto: { totalWallets: cryptoStats },
        transactions: { total: transactionStats },
      };
    } catch (error: any) {
      logger.error('Failed to get platform stats:', error);
      throw error;
    }
  }

  /**
   * Generate admin report for a specific time period
   */
  static async generateReport(startDate: Date, endDate: Date) {
    try {
      const [newUsers, newSubscriptions, revenue, topUsers, errorCount] = await Promise.all([
        prisma.user.count({
          where: {
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          },
        }),

        prisma.subscription.count({
          where: {
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          },
        }),

        prisma.payment.aggregate({
          where: {
            status: 'SUCCEEDED',
            paymentDate: {
              gte: startDate,
              lte: endDate,
            },
          },
          _sum: { amount: true },
          _count: true,
        }),

        prisma.$queryRaw`
          SELECT 
            u.email,
            u."firstName",
            u."lastName",
            COUNT(ut.*)::int as usage_count
          FROM "UsageTracking" ut
          JOIN users u ON ut."userId" = u.id
          WHERE ut.timestamp >= ${startDate} AND ut.timestamp <= ${endDate}
          GROUP BY u.id, u.email, u."firstName", u."lastName"
          ORDER BY usage_count DESC
          LIMIT 10
        `,

        prisma.auditLog.count({
          where: {
            action: { contains: 'ERROR' },
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          },
        }),
      ]);

      return {
        period: { startDate, endDate },
        metrics: {
          newUsers,
          newSubscriptions,
          revenue: revenue._sum.amount || 0,
          revenueTransactions: revenue._count,
          topUsers,
          errorCount,
        },
        generatedAt: new Date(),
      };
    } catch (error: any) {
      logger.error('Failed to generate admin report:', error);
      throw error;
    }
  }

  /**
   * Perform system maintenance tasks
   */
  static async performMaintenance() {
    try {
      const results = {
        expiredSessions: 0,
        oldAuditLogs: 0,
        orphanedRecords: 0,
      };

      // Clean up expired sessions (older than 30 days)
      const expiredSessionsResult = await prisma.session.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      results.expiredSessions = expiredSessionsResult.count;

      // Clean up old audit logs (older than 1 year)
      const oldLogsResult = await prisma.auditLog.deleteMany({
        where: {
          createdAt: {
            lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          },
        },
      });
      results.oldAuditLogs = oldLogsResult.count;

      // Log maintenance action
      await prisma.auditLog.create({
        data: {
          userId: 'SYSTEM',
          action: 'SYSTEM_MAINTENANCE',
          resource: 'system',
          resourceId: 'maintenance',
          details: results,
        },
      });

      logger.info('System maintenance completed:', results);
      return results;
    } catch (error: any) {
      logger.error('System maintenance failed:', error);
      throw error;
    }
  }

  /**
   * Validate admin permissions for sensitive operations
   */
  static async validateAdminPermissions(userId: string, action: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, status: true, email: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      if (user['role'] !== 'ADMIN') {
        throw new Error('Admin role required');
      }

      if (user['status'] !== 'ACTIVE') {
        throw new Error('User account is not active');
      }

      // Log the permission check
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'ADMIN_PERMISSION_CHECK',
          resource: 'admin',
          resourceId: action,
          details: {
            email: user['email'],
            action,
            result: 'GRANTED',
          },
        },
      });

      return true;
    } catch (error: any) {
      // Log failed permission check
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'ADMIN_PERMISSION_CHECK',
          resource: 'admin',
          resourceId: action,
          details: {
            action,
            result: 'DENIED',
            error: error.message,
          },
        },
      });

      throw error;
    }
  }

  /**
   * Get system alerts and warnings
   */
  static async getSystemAlerts() {
    try {
      const alerts = [];

      // Check for high error rate in the last hour
      const recentErrors = await prisma.auditLog.count({
        where: {
          action: { contains: 'ERROR' },
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000),
          },
        },
      });

      if (recentErrors > 100) {
        alerts.push({
          type: 'ERROR',
          severity: 'HIGH',
          message: `High error rate detected: ${recentErrors} errors in the last hour`,
          timestamp: new Date(),
        });
      }

      // Check for failed payments
      const failedPayments = await prisma.payment.count({
        where: {
          status: 'FAILED',
          paymentDate: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });

      if (failedPayments > 10) {
        alerts.push({
          type: 'PAYMENT',
          severity: 'MEDIUM',
          message: `${failedPayments} failed payments in the last 24 hours`,
          timestamp: new Date(),
        });
      }

      // Check for database performance
      const dbCheckStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const dbResponseTime = Date.now() - dbCheckStart;

      if (dbResponseTime > 2000) {
        alerts.push({
          type: 'PERFORMANCE',
          severity: 'MEDIUM',
          message: `Database response time is slow: ${dbResponseTime}ms`,
          timestamp: new Date(),
        });
      }

      return alerts;
    } catch (error: any) {
      logger.error('Failed to get system alerts:', error);
      return [
        {
          type: 'SYSTEM',
          severity: 'HIGH',
          message: 'Failed to check system alerts',
          timestamp: new Date(),
        },
      ];
    }
  }
}

export const adminHelpers = AdminHelpers;
