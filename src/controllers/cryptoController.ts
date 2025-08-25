import { Request, Response } from 'express';
import { cryptoService } from '@/services/cryptoService';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import {
  CreateWalletSchema,
  UpdateWalletSchema,
  WalletParamsSchema,
  GetWalletTransactionsQuerySchema,
  GetWalletNFTsQuerySchema,
  GetWalletDeFiQuerySchema,
  PortfolioQuerySchema,
  SyncWalletSchema,
  AnalyticsQuerySchema,
  ExportRequestSchema,
} from '@/utils/cryptoValidation';
import { CryptoServiceError } from '@/types/crypto';

export class CryptoController {

  // ===============================
  // WALLET MANAGEMENT
  // ===============================

  async addWallet(req: Request, res: Response) {
    try {
      // Get user ID from auth middleware
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate request body
      const validatedData = CreateWalletSchema.parse(req.body);

      // Add wallet
      const wallet = await cryptoService.addWallet(userId, validatedData);

      // Track usage
      logger.info(`Crypto wallet added by user ${userId}`, {
        userId,
        walletId: wallet.id,
        address: wallet.address,
        network: wallet.network,
        type: wallet.type
      });

      res.status(201).json({
        success: true,
        data: wallet,
        message: 'Crypto wallet added successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async removeWallet(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params
      const { walletId } = WalletParamsSchema.parse(req.params);

      // Remove wallet
      await cryptoService.removeWallet(userId, walletId);

      logger.info(`Crypto wallet removed by user ${userId}`, {
        userId,
        walletId
      });

      res.json({
        success: true,
        message: 'Crypto wallet removed successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async updateWallet(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params and body
      const { walletId } = WalletParamsSchema.parse(req.params);
      const validatedData = UpdateWalletSchema.parse(req.body);

      // Update wallet
      const wallet = await cryptoService.updateWallet(userId, walletId, validatedData);

      logger.info(`Crypto wallet updated by user ${userId}`, {
        userId,
        walletId,
        changes: Object.keys(validatedData)
      });

      res.json({
        success: true,
        data: wallet,
        message: 'Crypto wallet updated successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getUserWallets(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Get wallets
      const wallets = await cryptoService.getUserWallets(userId);

      res.json({
        success: true,
        data: wallets,
        message: 'Crypto wallets retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getWalletDetails(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params and query
      const { walletId } = WalletParamsSchema.parse(req.params);
      PortfolioQuerySchema.partial().parse(req.query);

      // Get wallet portfolio
      const portfolio = await cryptoService.getWalletPortfolio(userId, walletId);

      res.json({
        success: true,
        data: portfolio,
        message: 'Wallet portfolio retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // PORTFOLIO DATA
  // ===============================

  async getAggregatedPortfolio(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query params
      PortfolioQuerySchema.partial().parse(req.query);

      // Get aggregated portfolio
      const portfolio = await cryptoService.getAggregatedPortfolio(userId);

      res.json({
        success: true,
        data: portfolio,
        message: 'Aggregated portfolio retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // TRANSACTION HISTORY
  // ===============================

  async getWalletTransactions(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params and query
      const { walletId } = WalletParamsSchema.parse(req.params);
      const queryParams = GetWalletTransactionsQuerySchema.parse(req.query);

      // Extract pagination and filters
      const { page, limit, ...filters } = queryParams;
      const pagination = { page, limit };

      // Get transactions
      const result = await cryptoService.getWalletTransactions(
        userId,
        walletId,
        filters,
        pagination
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'Wallet transactions retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getAllTransactions(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query params
      const queryParams = GetWalletTransactionsQuerySchema.parse(req.query);
      const { page, limit, ...filters } = queryParams;
      const pagination = { page, limit };

      // Get user wallets first
      const wallets = await cryptoService.getUserWallets(userId);
      
      if (!wallets) {
        throw new AppError('Failed to retrieve wallets', 500);
      }
      
      if (wallets.length === 0) {
        res.json({
          success: true,
          data: [],
          pagination: {
            page: 1,
            limit,
            total: 0,
            pages: 0,
            hasNext: false,
            hasPrev: false
          },
          message: 'No wallets found'
        });
        return;
      }

      // For simplicity, get transactions from the first wallet
      // In a real implementation, you'd aggregate across all wallets
      const firstWallet = wallets[0];
      if (!firstWallet) {
        throw new AppError('No wallet found to retrieve transactions', 404);
      }
      
      const result = await cryptoService.getWalletTransactions(
        userId,
        firstWallet.id,
        filters,
        pagination
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'Transactions retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // NFT MANAGEMENT
  // ===============================

  async getWalletNFTs(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params and query
      const { walletId } = WalletParamsSchema.parse(req.params);
      const queryParams = GetWalletNFTsQuerySchema.parse(req.query);

      // Extract pagination and filters
      const { page, limit, ...filters } = queryParams;
      const pagination = { page, limit };

      // Get NFTs
      const result = await cryptoService.getWalletNFTs(
        userId,
        walletId,
        filters,
        pagination
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'Wallet NFTs retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getAllNFTs(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query params
      const queryParams = GetWalletNFTsQuerySchema.parse(req.query);
      const { page, limit, ...filters } = queryParams;
      const pagination = { page, limit };

      // Get user wallets first
      const wallets = await cryptoService.getUserWallets(userId);
      
      if (!wallets) {
        throw new AppError('Failed to retrieve wallets', 500);
      }
      
      if (wallets.length === 0) {
        res.json({
          success: true,
          data: [],
          pagination: {
            page: 1,
            limit,
            total: 0,
            pages: 0,
            hasNext: false,
            hasPrev: false
          },
          message: 'No wallets found'
        });
        return;
      }

      // For simplicity, get NFTs from the first wallet
      // In a real implementation, you'd aggregate across all wallets
      const firstWallet = wallets[0];
      if (!firstWallet) {
        throw new AppError('No wallet found to retrieve NFTs', 404);
      }
      
      const result = await cryptoService.getWalletNFTs(
        userId,
        firstWallet.id,
        filters,
        pagination
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'NFTs retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // DeFi POSITIONS
  // ===============================

  async getWalletDeFiPositions(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params and query
      const { walletId } = WalletParamsSchema.parse(req.params);
      const queryParams = GetWalletDeFiQuerySchema.parse(req.query);

      // Extract pagination and filters
      const { page, limit, ...filters } = queryParams;
      const pagination = { page, limit };

      // Get DeFi positions
      const result = await cryptoService.getWalletDeFiPositions(
        userId,
        walletId,
        filters,
        pagination
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'Wallet DeFi positions retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getAllDeFiPositions(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query params
      const queryParams = GetWalletDeFiQuerySchema.parse(req.query);
      const { page, limit, ...filters } = queryParams;
      const pagination = { page, limit };

      // Get user wallets first
      const wallets = await cryptoService.getUserWallets(userId);
      
      if (!wallets) {
        throw new AppError('Failed to retrieve wallets', 500);
      }
      
      if (wallets.length === 0) {
        res.json({
          success: true,
          data: [],
          pagination: {
            page: 1,
            limit,
            total: 0,
            pages: 0,
            hasNext: false,
            hasPrev: false
          },
          message: 'No wallets found'
        });
        return;
      }

      // For simplicity, get DeFi positions from the first wallet
      // In a real implementation, you'd aggregate across all wallets
      const firstWallet = wallets[0];
      if (!firstWallet) {
        throw new AppError('No wallet found to retrieve DeFi positions', 404);
      }
      
      const result = await cryptoService.getWalletDeFiPositions(
        userId,
        firstWallet.id,
        filters,
        pagination
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'DeFi positions retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // SYNC AND REFRESH
  // ===============================

  async syncWallet(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params and body
      const { walletId } = WalletParamsSchema.parse(req.params);
      const validatedData = SyncWalletSchema.parse(req.body);

      // TODO: Implement sync functionality
      // This would trigger background jobs to sync wallet data

      logger.info(`Wallet sync initiated by user ${userId}`, {
        userId,
        walletId,
        syncOptions: validatedData
      });

      res.json({
        success: true,
        message: 'Wallet sync initiated successfully',
        data: {
          walletId,
          syncId: `sync_${Date.now()}`, // Generate actual sync job ID
          status: 'initiated'
        }
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getSyncStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params
      const { walletId } = WalletParamsSchema.parse(req.params);

      // TODO: Get actual sync status from job queue
      const syncStatus = {
        walletId,
        status: 'completed', // 'pending', 'in_progress', 'completed', 'failed'
        lastSyncAt: new Date().toISOString(),
        progress: 100,
        syncedData: ['assets', 'transactions', 'nfts', 'defi'],
        errors: []
      };

      res.json({
        success: true,
        data: syncStatus,
        message: 'Sync status retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // ANALYTICS AND REPORTING
  // ===============================

  async getPortfolioAnalytics(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query params
      const queryParams = AnalyticsQuerySchema.parse(req.query);

      // TODO: Implement analytics functionality
      const analytics = {
        timeRange: queryParams.timeRange,
        totalValue: 0,
        dayChange: 0,
        dayChangePct: 0,
        chartData: [],
        topAssets: [],
        networkAllocation: [],
        performanceMetrics: {
          totalReturn: 0,
          totalReturnPct: 0,
          bestPerformer: null,
          worstPerformer: null
        }
      };

      res.json({
        success: true,
        data: analytics,
        message: 'Portfolio analytics retrieved successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // DATA EXPORT
  // ===============================

  async exportPortfolioData(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate request body
      const validatedData = ExportRequestSchema.parse(req.body);

      // TODO: Implement export functionality
      const exportJob = {
        exportId: `export_${Date.now()}`,
        format: validatedData.format,
        status: 'initiated',
        estimatedCompletionTime: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
      };

      logger.info(`Data export initiated by user ${userId}`, {
        userId,
        exportOptions: validatedData
      });

      res.json({
        success: true,
        data: exportJob,
        message: 'Data export initiated successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // PRIVATE HELPER METHODS
  // ===============================

  private handleError(error: any, res: Response) {
    // Handle CryptoServiceError
    if (error instanceof CryptoServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        }
      });
    }

    // Handle AppError
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: 'APP_ERROR',
          message: error.message,
        }
      });
    }

    // Handle validation errors
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    // Handle generic errors
    logger.error('Unexpected error in crypto controller:', error);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
}

export const cryptoController = new CryptoController();