import { Router } from 'express';
import {
  getPlans,
  getPlanComparison,
  getCurrentSubscription,
  createSubscription,
  updateSubscription,
  cancelSubscription,
  reactivateSubscription,
  getSubscriptionHistory,
  upgradeSubscription,
  downgradeSubscription,
} from '@/controllers/subscriptionController';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/utils/validation';
import { z } from 'zod';
import { PlanType, BillingPeriod } from '@prisma/client';

const router = Router();

// Validation schemas
const createSubscriptionSchema = z.object({
  body: z.object({
    planType: z.nativeEnum(PlanType),
    billingPeriod: z.nativeEnum(BillingPeriod),
    paymentMethodId: z.string().optional(),
  }),
});

const updateSubscriptionSchema = z.object({
  body: z.object({
    planType: z.nativeEnum(PlanType).optional(),
    billingPeriod: z.nativeEnum(BillingPeriod).optional(),
  }),
});

const cancelSubscriptionSchema = z.object({
  body: z.object({
    immediately: z.boolean().optional().default(false),
  }),
});

const upgradeSubscriptionSchema = z.object({
  body: z.object({
    planType: z.nativeEnum(PlanType),
    billingPeriod: z.nativeEnum(BillingPeriod).optional(),
  }),
});

const downgradeSubscriptionSchema = z.object({
  body: z.object({
    planType: z.nativeEnum(PlanType),
  }),
});

/**
 * @swagger
 * /api/v1/subscriptions/plans:
 *   get:
 *     summary: Get all available plans
 *     description: Retrieve all available subscription plans with features and pricing
 *     tags: [Subscriptions]
 *     responses:
 *       '200':
 *         description: Plans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Plan'
 */
router.get('/plans', getPlans);

/**
 * @swagger
 * /api/v1/subscriptions/plans/comparison:
 *   get:
 *     summary: Get plan comparison data
 *     description: Retrieve detailed comparison data for all plans with feature matrix
 *     tags: [Subscriptions]
 *     responses:
 *       '200':
 *         description: Plan comparison data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 */
router.get('/plans/comparison', getPlanComparison);

/**
 * @swagger
 * /api/v1/subscriptions/current:
 *   get:
 *     summary: Get current user subscription
 *     description: Retrieve current user's subscription details
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Current subscription retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/UserSubscription'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/current', requireAuth, getCurrentSubscription);

/**
 * @swagger
 * /api/v1/subscriptions:
 *   post:
 *     summary: Create subscription
 *     description: Create a new subscription for the current user
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planType:
 *                 type: string
 *                 enum: [FREE, PRO, ULTIMATE]
 *                 description: The plan to subscribe to
 *               billingPeriod:
 *                 type: string
 *                 enum: [MONTHLY, YEARLY]
 *                 description: Billing frequency
 *               paymentMethodId:
 *                 type: string
 *                 description: Payment method ID (optional for free plan)
 *             required:
 *               - planType
 *               - billingPeriod
 *           examples:
 *             createPro:
 *               summary: Subscribe to Pro plan
 *               value:
 *                 planType: "PRO"
 *                 billingPeriod: "MONTHLY"
 *                 paymentMethodId: "pm_1234567890"
 *     responses:
 *       '201':
 *         description: Subscription created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       '400':
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', requireAuth, validate(createSubscriptionSchema), createSubscription);

/**
 * @swagger
 * /api/v1/subscriptions:
 *   put:
 *     summary: Update subscription
 *     description: Update current user's subscription plan or billing period
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planType:
 *                 type: string
 *                 enum: [FREE, PRO, ULTIMATE]
 *                 description: New plan type (optional)
 *               billingPeriod:
 *                 type: string
 *                 enum: [MONTHLY, YEARLY]
 *                 description: New billing period (optional)
 *     responses:
 *       '200':
 *         description: Subscription updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 */
router.put('/', requireAuth, validate(updateSubscriptionSchema), updateSubscription);

/**
 * @swagger
 * /api/v1/subscriptions/upgrade:
 *   post:
 *     summary: Upgrade subscription
 *     description: Upgrade to a higher tier plan
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planType:
 *                 type: string
 *                 enum: [PRO, ULTIMATE]
 *                 description: Target plan for upgrade
 *               billingPeriod:
 *                 type: string
 *                 enum: [MONTHLY, YEARLY]
 *                 description: Billing period (optional)
 *             required:
 *               - planType
 *     responses:
 *       '200':
 *         description: Subscription upgraded successfully
 */
router.post('/upgrade', requireAuth, validate(upgradeSubscriptionSchema), upgradeSubscription);

/**
 * @swagger
 * /api/v1/subscriptions/downgrade:
 *   post:
 *     summary: Downgrade subscription
 *     description: Downgrade to a lower tier plan
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planType:
 *                 type: string
 *                 enum: [FREE, PRO]
 *                 description: Target plan for downgrade
 *             required:
 *               - planType
 *     responses:
 *       '200':
 *         description: Subscription downgraded successfully
 */
router.post(
  '/downgrade',
  requireAuth,
  validate(downgradeSubscriptionSchema),
  downgradeSubscription
);

/**
 * @swagger
 * /api/v1/subscriptions/cancel:
 *   post:
 *     summary: Cancel subscription
 *     description: Cancel current subscription (immediately or at period end)
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               immediately:
 *                 type: boolean
 *                 default: false
 *                 description: Cancel immediately (true) or at period end (false)
 *     responses:
 *       '200':
 *         description: Subscription cancelled successfully
 */
router.post('/cancel', requireAuth, validate(cancelSubscriptionSchema), cancelSubscription);

/**
 * @swagger
 * /api/v1/subscriptions/reactivate:
 *   post:
 *     summary: Reactivate subscription
 *     description: Reactivate a cancelled subscription (if still within period)
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Subscription reactivated successfully
 */
router.post('/reactivate', requireAuth, reactivateSubscription);

/**
 * @swagger
 * /api/v1/subscriptions/history:
 *   get:
 *     summary: Get subscription history
 *     description: Retrieve payment and subscription history for current user
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Subscription history retrieved successfully
 */
router.get('/history', requireAuth, getSubscriptionHistory);

export default router;
