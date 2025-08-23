import { Router } from 'express';
import {
  createPaymentIntent,
  processPayment,
  handleWebhook,
  getPaymentHistory,
  retryPayment,
} from '@/controllers/paymentController';
import { requireAuth } from '@/middleware/auth';
import { validate } from '@/utils/validation';
import { z } from 'zod';
import { PlanType, BillingPeriod } from '@prisma/client';

const router = Router();

// Validation schemas
const createPaymentIntentSchema = z.object({
  body: z.object({
    planType: z.nativeEnum(PlanType),
    billingPeriod: z.nativeEnum(BillingPeriod),
    currency: z.string().length(3).optional().default('USD'),
  }),
});

const processPaymentSchema = z.object({
  body: z.object({
    subscriptionId: z.string(),
    amount: z.number().positive(),
    currency: z.string().length(3).optional().default('USD'),
    paymentMethodId: z.string().optional(),
    invoiceId: z.string().optional(),
  }),
});

/**
 * @swagger
 * /api/v1/payments/intent:
 *   post:
 *     summary: Create payment intent
 *     description: Create a payment intent for subscription upgrade or payment
 *     tags: [Payments]
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
 *                 description: Target plan type
 *               billingPeriod:
 *                 type: string
 *                 enum: [MONTHLY, YEARLY]
 *                 description: Billing period
 *               currency:
 *                 type: string
 *                 default: USD
 *                 description: Currency code (3 letters)
 *             required:
 *               - planType
 *               - billingPeriod
 *     responses:
 *       '200':
 *         description: Payment intent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 */
router.post('/intent', requireAuth, validate(createPaymentIntentSchema), createPaymentIntent);

/**
 * @swagger
 * /api/v1/payments/process:
 *   post:
 *     summary: Process payment
 *     description: Process a payment for a subscription
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subscriptionId:
 *                 type: string
 *                 description: Subscription ID
 *               amount:
 *                 type: number
 *                 description: Payment amount
 *               currency:
 *                 type: string
 *                 default: USD
 *                 description: Currency code
 *               paymentMethodId:
 *                 type: string
 *                 description: Payment method ID (optional)
 *               invoiceId:
 *                 type: string
 *                 description: Invoice ID (optional)
 *             required:
 *               - subscriptionId
 *               - amount
 *     responses:
 *       '200':
 *         description: Payment processed successfully
 */
router.post('/process', requireAuth, validate(processPaymentSchema), processPayment);

/**
 * @swagger
 * /api/v1/payments/webhook:
 *   post:
 *     summary: Handle payment webhooks
 *     description: Handle webhooks from payment processors
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Webhook payload from payment processor
 *     responses:
 *       '200':
 *         description: Webhook processed successfully
 */
router.post('/webhook', handleWebhook);

/**
 * @swagger
 * /api/v1/payments/history:
 *   get:
 *     summary: Get payment history
 *     description: Retrieve payment history for the current user
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Payment history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 */
router.get('/history', requireAuth, getPaymentHistory);

/**
 * @swagger
 * /api/v1/payments/{paymentId}/retry:
 *   post:
 *     summary: Retry failed payment
 *     description: Retry a failed payment
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID to retry
 *     responses:
 *       '200':
 *         description: Payment retry successful
 */
router.post('/:paymentId/retry', requireAuth, retryPayment);

export default router;
