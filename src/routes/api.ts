import { Router } from 'express';
import {
  requireAuth,
  requireAdmin,
  authenticate,
  assertAuthenticatedUser,
} from '@/middleware/auth';
import { prisma } from '@/config/database';
import { logger } from '@/utils/logger';
import { planLimitsService } from '@/services/planLimitsService';
import { z } from 'zod';

const router = Router();

/**
 * @swagger
 * /api/v1/session:
 *   get:
 *     summary: Get current user session
 *     description: Check authentication status and get current user session
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Session information retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/session', authenticate, async (req, res) => {
  try {
    if (!req.user || !req.session) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        user: req.user,
        session: req.session,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v1/profile:
 *   get:
 *     summary: Get user profile
 *     description: Retrieve the authenticated user's profile information
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message,
    });
  }
});

// Validation schema for profile updates
const updateProfileSchema = z.object({
  firstName: z.string().min(2).max(50).optional(),
  lastName: z.string().min(2).max(50).optional(),
  phone: z
    .string()
    .regex(/^\+?[\d\s\-()]{10,15}$/)
    .optional()
    .nullable(),
  dateOfBirth: z.string().datetime().optional().nullable(),
  monthlyIncome: z.number().min(0).max(10000000).optional().nullable(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).optional(),
  timezone: z.string().optional(),
  profilePicture: z.string().url().optional().nullable(),
});

/**
 * @swagger
 * /api/v1/profile:
 *   patch:
 *     summary: Update user profile
 *     description: Update the authenticated user's profile information
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: "Doe"
 *               currency:
 *                 type: string
 *                 enum: [USD, EUR, GBP, CAD, AUD]
 *                 example: "USD"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const user = assertAuthenticatedUser(req);

    // Validate request body
    const validationResult = updateProfileSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: validationResult.error.errors,
      });
      return;
    }

    const updateData = validationResult.data;

    // Update user profile
    const updateFields: any = {};
    if (updateData.firstName !== undefined) updateFields.firstName = updateData.firstName;
    if (updateData.lastName !== undefined) updateFields.lastName = updateData.lastName;
    if (updateData.phone !== undefined) updateFields.phone = updateData.phone;
    if (updateData.dateOfBirth !== undefined)
      updateFields.dateOfBirth = updateData.dateOfBirth ? new Date(updateData.dateOfBirth) : null;
    if (updateData.monthlyIncome !== undefined)
      updateFields.monthlyIncome = updateData.monthlyIncome;
    if (updateData.currency !== undefined) updateFields.currency = updateData.currency;
    if (updateData.timezone !== undefined) updateFields.timezone = updateData.timezone;
    if (updateData.profilePicture !== undefined)
      updateFields.profilePicture = updateData.profilePicture;
    updateFields.updatedAt = new Date();

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateFields,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        dateOfBirth: true,
        monthlyIncome: true,
        currency: true,
        timezone: true,
        profilePicture: true,
        role: true,
        currentPlan: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    logger.info(`Profile updated for user: ${user.email}`);

    res.json({
      success: true,
      data: {
        user: {
          ...updatedUser,
          monthlyIncome: updatedUser.monthlyIncome ? Number(updatedUser.monthlyIncome) : null,
        },
      },
      message: 'Profile updated successfully',
    });
  } catch (error: any) {
    logger.error('Profile update error:', error);
    res.status(500).json({
      error: 'UPDATE_ERROR',
      message: 'Failed to update profile',
    });
  }
});

/**
 * Delete user account (protected route)
 */
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const user = assertAuthenticatedUser(req);

    // Soft delete by updating status instead of hard delete for audit purposes
    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'INACTIVE',
        email: `deleted_${Date.now()}_${user.email}`, // Anonymize email
        firstName: 'Deleted',
        lastName: 'User',
        phone: null,
        profilePicture: null,
        updatedAt: new Date(),
      },
    });

    // Revoke all sessions by deleting them
    await prisma.session.deleteMany({
      where: { userId: user.id },
    });

    // Log the account deletion
    await prisma.auditLog
      .create({
        data: {
          userId: user.id,
          action: 'ACCOUNT_DELETED',
          resource: 'user',
          resourceId: user.id,
          details: {
            deletedAt: new Date().toISOString(),
            originalEmail: user.email,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      })
      .catch((error) => {
        logger.error('Failed to log account deletion:', error);
      });

    logger.info(`Account deleted for user: ${user.email} (${user.id})`);

    res.json({
      success: true,
      message: "Account deleted successfully. We're sorry to see you go!",
    });
  } catch (error: any) {
    logger.error('Account deletion error:', error);
    res.status(500).json({
      error: 'DELETE_ERROR',
      message: 'Failed to delete account',
    });
  }
});

/**
 * @swagger
 * /api/v1/stats:
 *   get:
 *     summary: Get user statistics
 *     description: Retrieve aggregated statistics for the authenticated user
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User statistics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/UserStats'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const user = assertAuthenticatedUser(req);

    const [accountsCount, transactionsCount, categoriesCount, budgetsCount, goalsCount] =
      await Promise.all([
        prisma.financialAccount.count({ where: { userId: user.id } }),
        prisma.transaction.count({ where: { userId: user.id } }),
        prisma.category.count({ where: { userId: user.id } }),
        prisma.budget.count({ where: { userId: user.id } }),
        prisma.goal.count({ where: { userId: user.id } }),
      ]);

    res.json({
      success: true,
      data: {
        accounts: accountsCount,
        transactions: transactionsCount,
        categories: categoriesCount,
        budgets: budgetsCount,
        goals: goalsCount,
        currentPlan: user.currentPlan || 'FREE',
      },
    });
  } catch (error: any) {
    logger.error('Stats fetch error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to fetch user statistics',
    });
  }
});

/**
 * Admin route to get all users
 */
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 10));
    const offset = (page - 1) * limit;

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        skip: offset,
        take: limit,
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
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.user.count(),
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
    logger.error('Admin users fetch error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to fetch users',
    });
  }
});

/**
 * Admin route to get user details
 */
router.get('/admin/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId || '' },
      include: {
        subscription: true,
        usageTracking: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!user) {
      res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'User not found',
      });
      return;
    }

    res.json({
      success: true,
      data: { user },
    });
  } catch (error: any) {
    logger.error('Admin user details fetch error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to fetch user details',
    });
  }
});

/**
 * @swagger
 * /api/v1/limits:
 *   get:
 *     summary: Get user plan limits overview
 *     description: Retrieve current usage and limits for the authenticated user based on their plan
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User limits overview retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     planType:
 *                       type: string
 *                       enum: [FREE, PRO, ULTIMATE]
 *                       example: "FREE"
 *                     limits:
 *                       type: object
 *                       properties:
 *                         wallets:
 *                           type: object
 *                           properties:
 *                             current:
 *                               type: integer
 *                               example: 2
 *                             limit:
 *                               type: integer
 *                               example: 3
 *                             remaining:
 *                               type: integer
 *                               example: 1
 *                             percentage:
 *                               type: integer
 *                               example: 67
 *                         accounts:
 *                           type: object
 *                           properties:
 *                             current:
 *                               type: integer
 *                               example: 1
 *                             limit:
 *                               type: integer
 *                               example: 2
 *                             remaining:
 *                               type: integer
 *                               example: 1
 *                             percentage:
 *                               type: integer
 *                               example: 50
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/limits', requireAuth, async (req, res) => {
  try {
    const user = assertAuthenticatedUser(req);
    const limitsOverview = await planLimitsService.getUserLimitsOverview(user.id);

    res.json({
      success: true,
      data: limitsOverview,
    });
  } catch (error: any) {
    logger.error('Limits fetch error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to fetch user limits',
    });
  }
});

/**
 * Health check for API
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'mappr-api',
    timestamp: new Date().toISOString(),
    authenticated: !!req.user,
  });
});

export default router;
