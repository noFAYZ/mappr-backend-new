import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { adminController } from '@/controllers/adminController';
import { authenticate, requireAdmin } from '@/middleware/auth';
import { Request, Response, NextFunction } from 'express';

const router = Router();

// Async error handler wrapper
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Admin-specific rate limiting (more restrictive)
const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'ADMIN_RATE_LIMIT_EXCEEDED',
      message: 'Too many admin requests from this IP, please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply authentication and admin authorization to all routes
router.use(adminRateLimit);
router.use(authenticate);
router.use(requireAdmin);

// ===============================
// DASHBOARD & ANALYTICS ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/admin/dashboard/stats:
 *   get:
 *     summary: Get admin dashboard overview statistics
 *     description: Retrieve key metrics and KPIs for the admin dashboard
 *     tags: [Admin Dashboard]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully
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
 *                     users:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                           example: 1500
 *                         active:
 *                           type: integer
 *                           example: 850
 *                         newThisMonth:
 *                           type: integer
 *                           example: 120
 *                     subscriptions:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                           example: 500
 *                         active:
 *                           type: integer
 *                           example: 450
 *                     revenue:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: number
 *                           example: 25000.50
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Admin access required
 */
router.get('/dashboard/stats', asyncHandler(adminController.getDashboardStats.bind(adminController)));

/**
 * @swagger
 * /api/v1/admin/analytics/users:
 *   get:
 *     summary: Get user analytics and trends
 *     description: Retrieve detailed user analytics including growth, status breakdown, and activity
 *     tags: [Admin Analytics]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/analytics/users', asyncHandler(adminController.getUserAnalytics.bind(adminController)));

/**
 * @swagger
 * /api/v1/admin/analytics/revenue:
 *   get:
 *     summary: Get revenue and subscription analytics
 *     description: Retrieve revenue trends, subscription metrics, and churn analysis
 *     tags: [Admin Analytics]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Revenue analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/analytics/revenue', asyncHandler(adminController.getRevenueAnalytics.bind(adminController)));

/**
 * @swagger
 * /api/v1/admin/analytics/usage:
 *   get:
 *     summary: Get platform usage statistics
 *     description: Retrieve feature usage breakdown and trends
 *     tags: [Admin Analytics]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: timeRange
 *         in: query
 *         schema:
 *           type: string
 *           enum: [1d, 7d, 30d]
 *           default: 7d
 *         description: Time range for usage statistics
 *     responses:
 *       200:
 *         description: Usage statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/analytics/usage', asyncHandler(adminController.getUsageStats.bind(adminController)));

// ===============================
// SYSTEM MONITORING ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/admin/system/health:
 *   get:
 *     summary: Get system health and performance metrics
 *     description: Retrieve system health status, database performance, and error rates
 *     tags: [Admin System]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: System health retrieved successfully
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
 *                     database:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           example: healthy
 *                         responseTime:
 *                           type: number
 *                           example: 15
 *                     api:
 *                       type: object
 *                       properties:
 *                         requestsLast24h:
 *                           type: integer
 *                           example: 15420
 *                         errorsLast24h:
 *                           type: integer
 *                           example: 12
 *                     uptime:
 *                       type: number
 *                       example: 86400
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/system/health', asyncHandler(adminController.getSystemHealth.bind(adminController)));

// ===============================
// USER MANAGEMENT ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/admin/users:
 *   get:
 *     summary: Get all users with filtering and pagination
 *     description: Retrieve users with advanced filtering, search, and pagination capabilities
 *     tags: [Admin User Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of users per page
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE, SUSPENDED, PENDING_VERIFICATION]
 *         description: Filter by user status
 *       - name: plan
 *         in: query
 *         schema:
 *           type: string
 *           enum: [FREE, PRO, ULTIMATE]
 *         description: Filter by subscription plan
 *       - name: search
 *         in: query
 *         schema:
 *           type: string
 *         description: Search by email, first name, or last name
 *     responses:
 *       200:
 *         description: Users retrieved successfully
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
 *                     users:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           email:
 *                             type: string
 *                           firstName:
 *                             type: string
 *                           lastName:
 *                             type: string
 *                           role:
 *                             type: string
 *                           status:
 *                             type: string
 *                           currentPlan:
 *                             type: string
 *                           emailVerified:
 *                             type: boolean
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           lastLoginAt:
 *                             type: string
 *                             format: date-time
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         totalPages:
 *                           type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/users', asyncHandler(adminController.getUsers.bind(adminController)));

/**
 * @swagger
 * /api/v1/admin/users/{userId}:
 *   put:
 *     summary: Update user details (admin only)
 *     description: Update user status, role, plan, or email verification status
 *     tags: [Admin User Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to update
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE, SUSPENDED, PENDING_VERIFICATION]
 *                 example: ACTIVE
 *               role:
 *                 type: string
 *                 enum: [USER, ADMIN, PREMIUM]
 *                 example: USER
 *               currentPlan:
 *                 type: string
 *                 enum: [FREE, PRO, ULTIMATE]
 *                 example: PRO
 *               emailVerified:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.put('/users/:userId', asyncHandler(adminController.updateUser.bind(adminController)));

// ===============================
// AUDIT & LOGGING ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/admin/audit/logs:
 *   get:
 *     summary: Get audit logs for admin actions
 *     description: Retrieve system audit logs with filtering and pagination
 *     tags: [Admin Audit]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of logs per page
 *       - name: action
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter by action type
 *       - name: resource
 *         in: query
 *         schema:
 *           type: string
 *         description: Filter by resource type
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/audit/logs', asyncHandler(adminController.getAuditLogs.bind(adminController)));

// ===============================
// SYSTEM MANAGEMENT ROUTES
// ===============================

/**
 * @swagger
 * /api/v1/admin/system/alerts:
 *   get:
 *     summary: Get system alerts and warnings
 *     description: Retrieve active system alerts, warnings, and notifications
 *     tags: [Admin System]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: System alerts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/system/alerts', asyncHandler(adminController.getSystemAlerts.bind(adminController)));

/**
 * @swagger
 * /api/v1/admin/system/maintenance:
 *   post:
 *     summary: Perform system maintenance
 *     description: Execute system maintenance tasks like cleanup and optimization
 *     tags: [Admin System]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: System maintenance completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient permissions for maintenance operations
 */
router.post('/system/maintenance', asyncHandler(adminController.performMaintenance.bind(adminController)));

/**
 * @swagger
 * /api/v1/admin/reports/generate:
 *   get:
 *     summary: Generate comprehensive system report
 *     description: Generate detailed reports for specified time periods
 *     tags: [Admin Analytics]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: startDate
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *         description: Report start date (defaults to 30 days ago)
 *       - name: endDate
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *         description: Report end date (defaults to today)
 *     responses:
 *       200:
 *         description: Report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/reports/generate', asyncHandler(adminController.generateReport.bind(adminController)));

/**
 * @swagger
 * /api/v1/admin/platform/stats:
 *   get:
 *     summary: Get comprehensive platform statistics
 *     description: Retrieve detailed platform-wide statistics and metrics
 *     tags: [Admin Dashboard]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Platform statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/platform/stats', asyncHandler(adminController.getPlatformStats.bind(adminController)));

export default router;