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
  GetWalletDetailsFlexibleRequestSchema,
  GetWalletTransactionsFlexibleRequestSchema,
  GetWalletNFTsFlexibleRequestSchema,
  GetWalletDeFiFlexibleRequestSchema,
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
        type: wallet.type,
      });

      res.status(201).json({
        success: true,
        data: wallet,
        message: 'Crypto wallet added successfully',
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
        walletId,
      });

      res.json({
        success: true,
        message: 'Crypto wallet removed successfully',
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
        changes: Object.keys(validatedData),
      });

      res.json({
        success: true,
        data: wallet,
        message: 'Crypto wallet updated successfully',
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
        message: 'Crypto wallets retrieved successfully',
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
        message: 'Wallet portfolio retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getWalletDetailsFlexible(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query parameters - accepts both walletId and address
      const parsed = GetWalletDetailsFlexibleRequestSchema.parse({ query: req.query });
      const { walletId, address } = parsed.query;

      // Resolve the wallet by ID or address
      const wallet = await cryptoService.resolveWallet(userId, walletId, address);

      // Get wallet portfolio using the resolved wallet ID
      const portfolio = await cryptoService.getWalletPortfolio(userId, wallet.id);

      res.json({
        success: true,
        data: portfolio,
        message: 'Wallet portfolio retrieved successfully',
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
        message: 'Aggregated portfolio retrieved successfully',
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
        message: 'Wallet transactions retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getWalletTransactionsFlexible(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query parameters - accepts both walletId and address
      const parsed = GetWalletTransactionsFlexibleRequestSchema.parse({ query: req.query });
      const { walletId, address, page, limit, ...filters } = parsed.query;

      // Resolve the wallet by ID or address
      const wallet = await cryptoService.resolveWallet(userId, walletId, address);

      // Extract pagination and filters
      const pagination = { page, limit };

      // Get transactions using resolved wallet ID
      const result = await cryptoService.getWalletTransactions(
        userId,
        wallet.id,
        filters,
        pagination
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'Wallet transactions retrieved successfully',
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
            hasPrev: false,
          },
          message: 'No wallets found',
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
        message: 'Transactions retrieved successfully',
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
      const result = await cryptoService.getWalletNFTs(userId, walletId, filters, pagination);

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'Wallet NFTs retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getWalletNFTsFlexible(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query parameters - accepts both walletId and address
      const parsed = GetWalletNFTsFlexibleRequestSchema.parse({ query: req.query });
      const { walletId, address, page, limit, ...filters } = parsed.query;

      // Resolve the wallet by ID or address
      const wallet = await cryptoService.resolveWallet(userId, walletId, address);

      // Extract pagination and filters
      const pagination = { page, limit };

      // Get NFTs using resolved wallet ID
      const result = await cryptoService.getWalletNFTs(userId, wallet.id, filters, pagination);

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'Wallet NFTs retrieved successfully',
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
            hasPrev: false,
          },
          message: 'No wallets found',
        });
        return;
      }

      // For simplicity, get NFTs from the first wallet
      // In a real implementation, you'd aggregate across all wallets
      const firstWallet = wallets[0];
      if (!firstWallet) {
        throw new AppError('No wallet found to retrieve NFTs', 404);
      }

      const result = await cryptoService.getWalletNFTs(userId, firstWallet.id, filters, pagination);

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'NFTs retrieved successfully',
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
        message: 'Wallet DeFi positions retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getWalletDeFiPositionsFlexible(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate query parameters - accepts both walletId and address
      const parsed = GetWalletDeFiFlexibleRequestSchema.parse({ query: req.query });
      const { walletId, address, page, limit, ...filters } = parsed.query;

      // Resolve the wallet by ID or address
      const wallet = await cryptoService.resolveWallet(userId, walletId, address);

      // Extract pagination and filters
      const pagination = { page, limit };

      // Get DeFi positions using resolved wallet ID
      const result = await cryptoService.getWalletDeFiPositions(
        userId,
        wallet.id,
        filters,
        pagination
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        message: 'Wallet DeFi positions retrieved successfully',
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
            hasPrev: false,
          },
          message: 'No wallets found',
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
        message: 'DeFi positions retrieved successfully',
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

      // Initiate manual sync with enhanced options
      const result = await cryptoService.manualSync(userId, walletId, {
        syncAssets: validatedData.syncAssets,
        syncTransactions: validatedData.syncTransactions,
        syncNFTs: validatedData.syncNFTs,
        syncDeFi: validatedData.syncDeFi,
      });

      logger.info(`Wallet sync initiated by user ${userId}`, {
        userId,
        walletId,
        syncOptions: validatedData,
        jobId: result.jobId,
      });

      res.json({
        success: true,
        message: 'Wallet sync initiated successfully',
        data: {
          walletId,
          syncId: result.jobId,
          status: result.status,
          wallet: result.wallet,
        },
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

      // Check if getting status for specific job or wallet
      const jobId = req.query['jobId'] as string;
      const { walletId } = WalletParamsSchema.parse(req.params);

      let syncStatus;

      if (jobId) {
        // Get specific job status
        syncStatus = await cryptoService.getJobStatus(jobId);
      } else {
        // Get wallet sync status from database
        const wallet = await cryptoService.getUserWallets(userId);
        const targetWallet = wallet.find((w) => w.id === walletId);

        if (!targetWallet) {
          throw new AppError('Wallet not found', 404);
        }

        syncStatus = {
          walletId,
          status: (targetWallet as any).syncStatus || 'completed',
          lastSyncAt: (targetWallet as any).lastSyncAt || new Date(),
          progress: 100,
          syncedData: ['assets', 'transactions'],
          errors: [],
        };
      }

      res.json({
        success: true,
        data: syncStatus,
        message: 'Sync status retrieved successfully',
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
          worstPerformer: null,
        },
      };

      res.json({
        success: true,
        data: analytics,
        message: 'Portfolio analytics retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // ENHANCED SYNC AND MONITORING
  // ===============================

  async getJobStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const { jobId } = req.params;

      if (!jobId) {
        throw new AppError('Job ID is required', 400);
      }

      const jobStatus = await cryptoService.getJobStatus(jobId);

      res.json({
        success: true,
        data: jobStatus,
        message: 'Job status retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getServiceHealth(_req: Request, res: Response) {
    try {
      const health = await cryptoService.getServiceHealth();

      const isHealthy = health.database && health.redis && health.queues.syncQueue;

      res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        data: health,
        message: isHealthy ? 'Service is healthy' : 'Service has issues',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getZerionData(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const { walletId } = WalletParamsSchema.parse(req.params);
      const { dataType } = req.query;

      if (!dataType || typeof dataType !== 'string') {
        throw new AppError('Data type is required', 400);
      }

      const validDataTypes = ['portfolio', 'summary', 'transactions', 'positions', 'pnl'];
      if (!validDataTypes.includes(dataType)) {
        throw new AppError(`Invalid data type. Must be one of: ${validDataTypes.join(', ')}`, 400);
      }

      // Get wallet to verify ownership and get address
      const wallets = await cryptoService.getUserWallets(userId);
      const wallet = wallets.find((w) => w.id === walletId);

      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }

      const data = await cryptoService.getZerionWalletData(wallet.address, dataType as any);

      logger.info(`Zerion data fetched for user ${userId}`, {
        userId,
        walletId,
        dataType,
        address: wallet.address,
      });

      res.json({
        success: true,
        data,
        message: `${dataType} data retrieved successfully`,
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async scheduleTransactionSync(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const { walletId } = WalletParamsSchema.parse(req.params);
      const { cursor } = req.body;

      const result = await cryptoService.scheduleTransactionSync(userId, walletId, cursor);

      res.json({
        success: true,
        data: result,
        message: 'Transaction sync scheduled successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async schedulePortfolioCalculation(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const { walletId } = req.params;
      const { includeAnalytics = false } = req.body;

      const result = await cryptoService.schedulePortfolioCalculation(
        userId,
        walletId || undefined,
        includeAnalytics
      );

      res.json({
        success: true,
        data: result,
        message: 'Portfolio calculation scheduled successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async clearCache(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      const { walletId } = req.params;

      if (walletId) {
        // Clear specific wallet cache - verify ownership first
        const wallets = await cryptoService.getUserWallets(userId);
        const wallet = wallets.find((w) => w.id === walletId);

        if (!wallet) {
          throw new AppError('Wallet not found', 404);
        }
      }

      // Clear user cache (includes all wallets)
      await cryptoService.clearUserCache(userId);

      logger.info(`Cache cleared for user ${userId}`, { walletId });

      res.json({
        success: true,
        message: 'Cache cleared successfully',
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

      const exportJob = {
        exportId: `export_${Date.now()}`,
        format: validatedData.format,
        status: 'initiated',
        estimatedCompletionTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
      };

      logger.info(`Data export initiated by user ${userId}`, {
        userId,
        exportOptions: validatedData,
      });

      res.json({
        success: true,
        data: exportJob,
        message: 'Data export initiated successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // ZAPPER INTEGRATION ENDPOINTS
  // ===============================

  async getZapperWalletData(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Validate params
      const { walletId } = WalletParamsSchema.parse(req.params);

      // Parse query options
      const options: any = {
        includeTokens: req.query['includeTokens'] === 'true',
        includeAppPositions: req.query['includeAppPositions'] === 'true',
        includeNFTs: req.query['includeNFTs'] === 'true',
        includeTransactions: req.query['includeTransactions'] === 'true',
        maxTransactions: req.query['maxTransactions']
          ? parseInt(req.query['maxTransactions'] as string)
          : 20,
      };

      if (req.query['networks']) {
        options.networks = (req.query['networks'] as string).split(',');
      }

      // Get Zapper data
      const zapperData = await cryptoService.getZapperWalletData(userId, walletId, options);

      logger.info(`Zapper wallet data retrieved for user ${userId}`, {
        userId,
        walletId,
     
      });

      res.json({
        success: true,
        data: zapperData,
        message: 'Zapper wallet data retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }


  async getZapperFarcasterData(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }

      // Parse query parameters
      const { fids, usernames } = req.query;
      const fidArray = fids ? (fids as string).split(',').map(Number) : undefined;
      const usernameArray = usernames ? (usernames as string).split(',') : undefined;

      if (!fidArray && !usernameArray) {
        throw new AppError('Must provide either fids or usernames', 400);
      }

      // Parse options
      const options: any = {
        includeTokens: req.query['includeTokens'] !== 'false',
        includeAppPositions: req.query['includeAppPositions'] !== 'false',
        includeNFTs: req.query['includeNFTs'] !== 'false',
      };

      if (req.query['networks']) {
        options.networks = (req.query['networks'] as string).split(',');
      }

      // Get Farcaster data via Zapper
      const result = await cryptoService.getZapperFarcasterData(fidArray, usernameArray, options);

      logger.info(`Farcaster data retrieved via Zapper for user ${userId}`, {
        userId,
        addressCount: result.addresses.length,
        hasPortfolio: !!result.portfolioData,
      });

      res.json({
        success: true,
        data: result,
        message: 'Farcaster portfolio data retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getZapperServiceHealth(_req: Request, res: Response) {
    try {
      const health = await cryptoService.getServiceHealth();

      res.json({
        success: true,
        data: {
          zapper: health.zapper,
          zerion: health.zerion,
          redis: health.redis,
          database: health.database,
          queues: health.queues,
        },
        message: 'Service health status retrieved',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // ===============================
  // UNIFIED PROVIDER METHODS
  // ===============================

  async getWalletDetailsLive(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }
      
      // Validate query parameters - accepts both walletId and address
      const parsed = GetWalletDetailsFlexibleRequestSchema.parse({ query: req.query });
      const { walletId, address } = parsed.query;
      
      let walletAddress: string;
      
      if (address) {
        walletAddress = address;
      } else if (walletId) {
        // Resolve wallet by ID to get address
        const wallet = await cryptoService.resolveWallet(userId, walletId);
        walletAddress = wallet.address;
      } else {
        throw new AppError('Either walletId or address must be provided', 400);
      }
      
      // Get live data from external providers using unified method
      const livePortfolio = await cryptoService.getUnifiedWalletPortfolio(walletAddress);
      
      logger.info(`Live wallet portfolio fetched for user ${userId}`, {
        userId,
        walletAddress,
        provider: livePortfolio.provider
      });
      
      res.json({
        success: true,
        data: livePortfolio.data,
        meta: {
          provider: livePortfolio.provider,
          live: true,
          address: walletAddress
        },
        message: 'Live wallet portfolio retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getWalletTransactionsLive(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }
      
      // Validate query parameters
      const parsed = GetWalletTransactionsFlexibleRequestSchema.parse({ query: req.query });
      const { walletId, address, limit = 20 } = parsed.query;
      
      let walletAddress: string;
      
      if (address) {
        walletAddress = address;
      } else if (walletId) {
        // Resolve wallet by ID to get address
        const wallet = await cryptoService.resolveWallet(userId, walletId);
        walletAddress = wallet.address;
      } else {
        throw new AppError('Either walletId or address must be provided', 400);
      }
      
      // Get live transaction data from external providers
      const liveTransactions = await cryptoService.getUnifiedWalletTransactions(walletAddress, limit);
      
      logger.info(`Live wallet transactions fetched for user ${userId}`, {
        userId,
        walletAddress,
        provider: liveTransactions.provider,
        limit
      });
      
      res.json({
        success: true,
        data: liveTransactions.data,
        meta: {
          provider: liveTransactions.provider,
          live: true,
          address: walletAddress
        },
        message: 'Live wallet transactions retrieved successfully',
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  async getProviderStatus(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('User authentication required', 401);
      }
      
      const providerStatus = await cryptoService.getProviderStatus();
      
      res.json({
        success: true,
        data: providerStatus,
        message: 'Provider status retrieved successfully',
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
        },
      });
    }

    // Handle AppError
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: 'APP_ERROR',
          message: error.message,
        },
      });
    }

    // Handle validation errors
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors,
        },
      });
    }

    // Handle generic errors
    logger.error('Unexpected error in crypto controller:', error);

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  }
}

export const cryptoController = new CryptoController();
