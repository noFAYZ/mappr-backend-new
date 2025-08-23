import { Request, Response, NextFunction } from 'express';
import { usageService } from '@/services/usageService';
import { AppError } from '@/middleware/errorHandler';

export const getUserUsageStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const usageStats = await usageService.getUserUsageStats(req.user.id);

    res.status(200).json({
      success: true,
      data: usageStats,
    });
  } catch (error) {
    next(error);
  }
};

export const checkFeatureLimit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { feature } = req.params;

    if (!feature) {
      throw new AppError('Feature parameter is required', 400);
    }

    const limitCheck = await usageService.checkFeatureLimit(req.user.id, feature);

    res.status(200).json({
      success: true,
      data: limitCheck,
    });
  } catch (error) {
    next(error);
  }
};

export const getUsageHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { feature } = req.query;
    const limit = parseInt((req.query['limit'] as string) || '100');

    if (limit > 1000) {
      throw new AppError('Limit cannot exceed 1000', 400);
    }

    const history = await usageService.getUsageHistory(req.user.id, feature as string, limit);

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

export const getUsageTrends = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { feature } = req.params;
    const days = parseInt((req.query['days'] as string) || '30');

    if (!feature) {
      throw new AppError('Feature parameter is required', 400);
    }

    if (days > 365) {
      throw new AppError('Days cannot exceed 365', 400);
    }

    const trends = await usageService.getFeatureUsageTrends(req.user.id, feature, days);

    res.status(200).json({
      success: true,
      data: trends,
    });
  } catch (error) {
    next(error);
  }
};

export const generateUsageReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const report = await usageService.generateUsageReport(req.user.id);

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    next(error);
  }
};

export const trackUsage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { feature, action, metadata } = req.body;

    if (!feature || !action) {
      throw new AppError('Feature and action are required', 400);
    }

    const usage = await usageService.trackUsage({
      userId: req.user.id,
      feature,
      action,
      metadata,
    });

    res.status(201).json({
      success: true,
      message: 'Usage tracked successfully',
      data: usage,
    });
  } catch (error) {
    next(error);
  }
};
