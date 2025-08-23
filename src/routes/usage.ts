import { Router } from 'express';
import {
  getUserUsageStats,
  checkFeatureLimit,
  getUsageHistory,
  getUsageTrends,
  generateUsageReport,
  trackUsage,
} from '@/controllers/usageController';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/utils/validation';
import { z } from 'zod';

const router = Router();

// Validation schemas
const trackUsageSchema = z.object({
  body: z.object({
    feature: z.string().min(1),
    action: z.string().min(1),
    metadata: z.record(z.any()).optional(),
  }),
});

/**
 * @swagger
 * /api/v1/usage/stats:
 *   get:
 *     summary: Get user usage statistics
 *     description: Retrieve current usage statistics for all features
 *     tags: [Usage]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Usage statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         accounts:
 *                           $ref: '#/components/schemas/UsageLimit'
 *                         transactions:
 *                           $ref: '#/components/schemas/UsageLimit'
 *                         categories:
 *                           $ref: '#/components/schemas/UsageLimit'
 *                         budgets:
 *                           $ref: '#/components/schemas/UsageLimit'
 *                         goals:
 *                           $ref: '#/components/schemas/UsageLimit'
 */
router.get('/stats', requireAuth, getUserUsageStats);

/**
 * @swagger
 * /api/v1/usage/check/{feature}:
 *   get:
 *     summary: Check feature usage limit
 *     description: Check if user can still use a specific feature
 *     tags: [Usage]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: feature
 *         required: true
 *         schema:
 *           type: string
 *           enum: [accounts, transactions, categories, budgets, goals]
 *         description: Feature to check
 *     responses:
 *       '200':
 *         description: Feature limit check result
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         allowed:
 *                           type: boolean
 *                           description: Whether feature usage is allowed
 *                         current:
 *                           type: number
 *                           description: Current usage count
 *                         limit:
 *                           type: number
 *                           description: Maximum allowed usage (-1 for unlimited)
 *                         remaining:
 *                           type: number
 *                           description: Remaining usage count (-1 for unlimited)
 */
router.get('/check/:feature', requireAuth, checkFeatureLimit);

/**
 * @swagger
 * /api/v1/usage/history:
 *   get:
 *     summary: Get usage history
 *     description: Retrieve usage history for the current user
 *     tags: [Usage]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: feature
 *         schema:
 *           type: string
 *         description: Filter by specific feature
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *         description: Number of records to return
 *     responses:
 *       '200':
 *         description: Usage history retrieved successfully
 */
router.get('/history', requireAuth, getUsageHistory);

/**
 * @swagger
 * /api/v1/usage/trends/{feature}:
 *   get:
 *     summary: Get usage trends
 *     description: Get usage trends for a specific feature over time
 *     tags: [Usage]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: feature
 *         required: true
 *         schema:
 *           type: string
 *         description: Feature to analyze
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 30
 *         description: Number of days to analyze
 *     responses:
 *       '200':
 *         description: Usage trends retrieved successfully
 */
router.get('/trends/:feature', requireAuth, getUsageTrends);

/**
 * @swagger
 * /api/v1/usage/report:
 *   get:
 *     summary: Generate usage report
 *     description: Generate a comprehensive usage report with recommendations
 *     tags: [Usage]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Usage report generated successfully
 */
router.get('/report', requireAuth, generateUsageReport);

/**
 * @swagger
 * /api/v1/usage/track:
 *   post:
 *     summary: Track feature usage
 *     description: Manually track usage of a feature (for API integrations)
 *     tags: [Usage]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               feature:
 *                 type: string
 *                 description: Feature name
 *                 example: 'api_call'
 *               action:
 *                 type: string
 *                 description: Action performed
 *                 example: 'create_transaction'
 *               metadata:
 *                 type: object
 *                 description: Additional metadata (optional)
 *             required:
 *               - feature
 *               - action
 *     responses:
 *       '201':
 *         description: Usage tracked successfully
 */
router.post('/track', requireAuth, validate(trackUsageSchema), trackUsage);

export default router;
