import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { PlanType, BillingPeriod, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { getPlanConfig } from '@/config/plans';

export interface PaymentRequest {
  subscriptionId: string;
  amount: number;
  currency?: string;
  paymentMethodId?: string;
  invoiceId?: string;
}

export interface PaymentIntentRequest {
  userId: string;
  planType: PlanType;
  billingPeriod: BillingPeriod;
  currency?: string;
}

export class PaymentService {
  async createPaymentIntent(data: PaymentIntentRequest) {
    try {
      const { userId, planType, billingPeriod, currency = 'USD' } = data;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { subscription: true },
      });

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const planConfig = getPlanConfig(planType);
      const amount =
        billingPeriod === BillingPeriod.YEARLY ? planConfig.yearlyPrice : planConfig.monthlyPrice;

      // For FREE plan, no payment needed
      if (planType === PlanType.FREE || amount === 0) {
        return {
          clientSecret: null,
          amount: 0,
          currency,
          requiresPayment: false,
        };
      }

      // In a real implementation, you would create a payment intent with Stripe
      // For now, we'll simulate the response structure
      const paymentIntentId = `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const clientSecret = `${paymentIntentId}_secret_${Math.random().toString(36).substr(2, 9)}`;

      logger.info(`Payment intent created for user ${userId}: ${amount} ${currency}`);

      return {
        paymentIntentId,
        clientSecret,
        amount: Number(amount) * 100, // Convert to cents
        currency,
        requiresPayment: true,
        metadata: {
          userId,
          planType,
          billingPeriod,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error creating payment intent:', error);
      throw new AppError('Failed to create payment intent', 500);
    }
  }

  async processPayment(data: PaymentRequest) {
    try {
      const { subscriptionId, amount, currency = 'USD', paymentMethodId, invoiceId } = data;

      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: { user: true },
      });

      if (!subscription) {
        throw new AppError('Subscription not found', 404);
      }

      // Create payment record
      const payment = await prisma.payment.create({
        data: {
          subscriptionId,
          amount,
          currency,
          status: PaymentStatus.PENDING,
          ...(paymentMethodId && { paymentMethodId }),
          ...(invoiceId && { invoiceId }),
          paymentDate: new Date(),
          metadata: {
            userId: subscription.userId,
            planType: subscription.planType,
            billingPeriod: subscription.billingPeriod,
          },
        },
      });

      // Simulate payment processing
      // In a real implementation, this would integrate with Stripe or another payment processor
      const paymentSuccessful = await this.simulatePaymentProcessing(payment.id);

      if (paymentSuccessful) {
        // Update payment status to succeeded
        const updatedPayment = await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            processedAt: new Date(),
          },
        });

        // Activate subscription if it was in trial or pending
        if (
          subscription.status === SubscriptionStatus.TRIAL ||
          subscription.status === SubscriptionStatus.PAST_DUE
        ) {
          await prisma.subscription.update({
            where: { id: subscriptionId },
            data: {
              status: SubscriptionStatus.ACTIVE,
              lastPaymentDate: new Date(),
            },
          });
        }

        logger.info(`Payment processed successfully: ${payment.id}`);
        return updatedPayment;
      } else {
        // Payment failed
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureReason: 'Payment processing failed',
            processedAt: new Date(),
          },
        });

        throw new AppError('Payment processing failed', 400);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error processing payment:', error);
      throw new AppError('Failed to process payment', 500);
    }
  }

  async handlePaymentWebhook(webhookData: any) {
    try {
      // This would handle webhooks from payment processors like Stripe
      // For now, we'll simulate the webhook handling
      const { type, data } = webhookData;

      switch (type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(data.object);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailure(data.object);
          break;
        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSuccess(data.object);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionCancellation(data.object);
          break;
        default:
          logger.warn(`Unhandled webhook type: ${type}`);
      }

      return { received: true };
    } catch (error) {
      logger.error('Error handling payment webhook:', error);
      throw new AppError('Failed to handle webhook', 500);
    }
  }

  private async simulatePaymentProcessing(_paymentId: string): Promise<boolean> {
    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 90% success rate for simulation
    return Math.random() > 0.1;
  }

  private async handlePaymentSuccess(paymentIntent: any) {
    const { metadata } = paymentIntent;

    if (metadata?.userId && metadata?.planType) {
      // Update user's subscription status
      const user = await prisma.user.findUnique({
        where: { id: metadata.userId },
        include: { subscription: true },
      });

      if (user?.subscription) {
        await prisma.subscription.update({
          where: { id: user.subscription.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            lastPaymentDate: new Date(),
          },
        });
      }
    }

    logger.info('Payment success handled via webhook');
  }

  private async handlePaymentFailure(paymentIntent: any) {
    const { metadata } = paymentIntent;

    if (metadata?.userId) {
      const user = await prisma.user.findUnique({
        where: { id: metadata.userId },
        include: { subscription: true },
      });

      if (user?.subscription) {
        await prisma.subscription.update({
          where: { id: user.subscription.id },
          data: {
            status: SubscriptionStatus.PAST_DUE,
          },
        });
      }
    }

    logger.info('Payment failure handled via webhook');
  }

  private async handleInvoicePaymentSuccess(_invoice: any) {
    logger.info('Invoice payment success handled via webhook');
  }

  private async handleSubscriptionCancellation(_subscription: any) {
    logger.info('Subscription cancellation handled via webhook');
  }

  async getPaymentHistory(userId: string) {
    try {
      const payments = await prisma.payment.findMany({
        where: {
          subscription: {
            userId,
          },
        },
        include: {
          subscription: {
            select: {
              planType: true,
              billingPeriod: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return payments;
    } catch (error) {
      logger.error('Error fetching payment history:', error);
      throw new AppError('Failed to fetch payment history', 500);
    }
  }

  async retryFailedPayment(paymentId: string) {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { subscription: true },
      });

      if (!payment) {
        throw new AppError('Payment not found', 404);
      }

      if (payment.status !== PaymentStatus.FAILED) {
        throw new AppError('Payment is not in failed status', 400);
      }

      // Retry payment processing
      const retrySuccessful = await this.simulatePaymentProcessing(paymentId);

      if (retrySuccessful) {
        const updatedPayment = await prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.SUCCEEDED,
            processedAt: new Date(),
          },
        });

        // Update subscription status if needed
        if (payment.subscription.status === SubscriptionStatus.PAST_DUE) {
          await prisma.subscription.update({
            where: { id: payment.subscriptionId },
            data: {
              status: SubscriptionStatus.ACTIVE,
              lastPaymentDate: new Date(),
            },
          });
        }

        logger.info(`Payment retry successful: ${paymentId}`);
        return updatedPayment;
      } else {
        throw new AppError('Payment retry failed', 400);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Error retrying payment:', error);
      throw new AppError('Failed to retry payment', 500);
    }
  }
}

export const paymentService = new PaymentService();
