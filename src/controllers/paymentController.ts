import { Request, Response, NextFunction } from 'express';
import { paymentService } from '@/services/paymentService';
import { AppError } from '@/middleware/errorHandler';
import { PlanType, BillingPeriod } from '@prisma/client';

export const createPaymentIntent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { planType, billingPeriod, currency } = req.body;

    if (!Object.values(PlanType).includes(planType)) {
      throw new AppError('Invalid plan type', 400);
    }

    if (!Object.values(BillingPeriod).includes(billingPeriod)) {
      throw new AppError('Invalid billing period', 400);
    }

    const paymentIntent = await paymentService.createPaymentIntent({
      userId: req.user.id,
      planType,
      billingPeriod,
      currency,
    });

    res.status(200).json({
      success: true,
      message: 'Payment intent created successfully',
      data: paymentIntent,
    });
  } catch (error) {
    next(error);
  }
};

export const processPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subscriptionId, amount, currency, paymentMethodId, invoiceId } = req.body;

    if (!subscriptionId || !amount) {
      throw new AppError('Subscription ID and amount are required', 400);
    }

    const payment = await paymentService.processPayment({
      subscriptionId,
      amount,
      currency,
      paymentMethodId,
      invoiceId,
    });

    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};

export const handleWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const webhookData = req.body;

    const result = await paymentService.handlePaymentWebhook(webhookData);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getPaymentHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const payments = await paymentService.getPaymentHistory(req.user.id);

    res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (error) {
    next(error);
  }
};

export const retryPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentId } = req.params;

    if (!paymentId) {
      throw new AppError('Payment ID is required', 400);
    }

    const payment = await paymentService.retryFailedPayment(paymentId);

    res.status(200).json({
      success: true,
      message: 'Payment retry successful',
      data: payment,
    });
  } catch (error) {
    next(error);
  }
};
