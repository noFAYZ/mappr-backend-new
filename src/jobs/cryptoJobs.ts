import { Job, Worker } from 'bullmq';
import { prisma } from '@/config/database';
import { logger } from '@/utils/logger';
import { createZerionService, ZerionService } from '@/services/zerionService';
import { AssetCacheService } from '@/services/assetCacheService';
import { cryptoService } from '@/services/cryptoService';
import { userSyncProgressManager } from '@/services/userSyncProgressManager';
import { QUEUE_NAMES, JOB_TYPES, queueManager } from '@/config/queue';
import {
  SyncWalletJobData,
  CreateSnapshotJobData,
  CryptoServiceError,
  CryptoErrorCodes,
} from '@/types/crypto';
import { AssetType, TransactionType, TransactionStatus } from '@prisma/client';
import ZapperService, { createZapperService } from '@/services/zapperService';

// Enhanced job processing statistics
interface JobStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  averageProcessingTime: number;
  lastProcessedAt: Date | null;
  peakMemoryUsage: number;
  averageMemoryUsage: number;
  errorBreakdown: Record<string, number>;
}

// Job processing context
interface JobContext {
  jobId: string;
  jobType: string;
  startTime: number;
  userId: string;
  walletId?: string;
}

// Job data interfaces
export interface SyncWalletFullJobData extends SyncWalletJobData {
  syncAssets?: boolean;
  syncTransactions?: boolean;
  syncNFTs?: boolean;
  syncDeFi?: boolean;
  syncTypes?: string[]; // New array format for sync types
}

export interface SyncTransactionsJobData {
  userId: string;
  walletId: string;
  fromBlock?: number;
  toBlock?: number;
  cursor?: string;
}

export interface CalculatePortfolioJobData {
  userId: string;
  walletId?: string;
  includeAnalytics?: boolean;
}

// ===============================
// JOB PROCESSORS
// ===============================

export class CryptoJobProcessor {
  private static instance: CryptoJobProcessor;
  private zerionService: ZerionService | null = null;
  private zapperService: ZapperService | null = null; // Placeholder for Zapper service
  private assetCacheService: AssetCacheService;
  private stats: Map<string, JobStats> = new Map();
  private activeJobs: Map<string, JobContext> = new Map(); // Track full context
  private maxConcurrentJobs: number = 10;
  private jobHealthMetrics: Map<string, number> = new Map(); // Track job health scores
  private memoryThreshold: number = 500 * 1024 * 1024; // 500MB memory threshold

  private constructor() {
    // Initialize asset cache service
    this.assetCacheService = new AssetCacheService();

    const zerionApiKey = process.env['ZERION_API_KEY'];

    if (!zerionApiKey) {
      logger.warn('ZERION_API_KEY environment variable not set', {
        impact: 'Crypto features will be limited',
        recommendation: 'Set ZERION_API_KEY environment variable for full functionality',
      });
    } else {
      try {
        this.zerionService = createZerionService({
          apiKey: zerionApiKey,
          timeout: 45000, // 45 seconds
          retries: 4,
          retryDelay: 2000,
        });

        logger.info('Zerion service initialized successfully', {
          hasService: !!this.zerionService,
          config: {
            timeout: 45000,
            retries: 4,
            circuitBreakerEnabled: true,
          },
        });
      } catch (error) {
        logger.error('Failed to initialize Zerion service', {
          error: error instanceof Error ? error.message : String(error),
          apiKeyProvided: !!zerionApiKey,
          apiKeyLength: zerionApiKey?.length,
        });
        // Don't throw error - service can work with limited functionality
      }
    }

    const zapperApiKey = process.env['ZAPPER_API_KEY'];
    if (!zapperApiKey) {
      logger.warn(
        'ZAPPER_API_KEY environment variable not set. Zapper integration will be disabled.'
      );
    } else {
      try {
        this.zapperService = createZapperService({
          apiKey: zapperApiKey,
          rateLimit: {
            requestsPerSecond: 10,
            maxConcurrent: 5,
          },
        });
        logger.info('Zapper service initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize Zapper service:', error);
        logger.warn('Service will continue without Zapper integration');
      }
    }

    // Initialize job statistics with enhanced tracking
    Object.values(JOB_TYPES).forEach((jobType) => {
      this.stats.set(jobType, {
        totalProcessed: 0,
        successful: 0,
        failed: 0,
        averageProcessingTime: 0,
        lastProcessedAt: null,
        peakMemoryUsage: 0,
        averageMemoryUsage: 0,
        errorBreakdown: {},
      });
    });

    // Start memory monitoring
    setInterval(() => this.monitorMemoryUsage(), 30000); // Every 30 seconds
    setInterval(() => this.cleanupStaleJobs(), 60000); // Every minute
  }

  static getInstance(): CryptoJobProcessor {
    if (!CryptoJobProcessor.instance) {
      CryptoJobProcessor.instance = new CryptoJobProcessor();
    }
    return CryptoJobProcessor.instance;
  }

  // ===============================
  // WALLET SYNC JOBS
  // ===============================

  async processSyncWallet(job: Job<SyncWalletJobData>): Promise<any> {
    const context = this.createJobContext(job, 'SYNC_WALLET');
    const { userId, walletId, fullSync = false } = job.data;

    if (!this.canProcessJob(context.jobId, 'SYNC_WALLET')) {
      throw new CryptoServiceError(
        'Cannot process job due to resource constraints',
        CryptoErrorCodes.RATE_LIMIT_EXCEEDED,
        429
      );
    }

    try {
      this.activeJobs.set(context.jobId, context);
      await job.updateProgress(0);

      // Start resource monitoring for this job
      const initialMemory = process.memoryUsage().heapUsed;

      logger.info('Starting wallet sync job', {
        ...context,
        fullSync,
        activeJobsCount: this.activeJobs.size,
      });

      // Publish sync started event
      await userSyncProgressManager.publishProgress(userId, walletId, {
        walletId,
        progress: 0,
        status: 'queued',
        message: 'Sync job queued',
        startedAt: new Date()
      });

      // Enhanced input validation
      await this.validateJobInputs({ userId, walletId, fullSync }, 'SYNC_WALLET');

      // Get wallet from database with transaction safety
      const wallet = await this.executeWithTransaction(
        async (tx) => await this.getWalletWithRetry(walletId, userId, context, 3, tx),
        'getWallet'
      );
      await job.updateProgress(10);

      // Publish sync started event with wallet info
      await userSyncProgressManager.publishProgress(userId, walletId, {
        walletId,
        progress: 10,
        status: 'syncing',
        message: `Starting sync for ${wallet.name} (${wallet.address.substring(0, 10)}...)`,
        startedAt: new Date()
      });

      if (!this.zerionService) {
        throw new CryptoServiceError(
          'Zerion service not initialized',
          CryptoErrorCodes.ZERION_API_ERROR,
          503
        );
      }

      // Check service health before proceeding
      const healthCheck = await this.zerionService.healthCheck();
      if (!healthCheck.healthy) {
        logger.warn('Zerion service health check failed, proceeding with caution', {
          ...context,
          healthCheck,
        });
      }

      // Update wallet status to syncing with atomic operation
      await this.executeWithTransaction(
        async (tx) => await this.updateWalletStatus(walletId, 'SYNCING', context, tx),
        'updateWalletStatus'
      );
      await job.updateProgress(15);

      // Publish syncing assets progress
      await userSyncProgressManager.publishProgress(userId, walletId, {
        walletId,
        progress: 15,
        status: 'syncing_assets',
        message: 'Fetching portfolio assets...',
      });

      // Sync basic portfolio data
      let portfolioData;
      try {
        portfolioData = await this.zerionService.getWalletPortfolio(wallet.address);
        await job.updateProgress(35);

        // Publish assets fetched
        await userSyncProgressManager.publishProgress(userId, walletId, {
          walletId,
          progress: 35,
          status: 'syncing_assets',
          message: 'Processing portfolio data...',
        });
      } catch (error) {
        logger.warn('Portfolio sync failed, continuing with limited data', {
          ...context,
          error: error instanceof Error ? error.message : String(error),
        });
        portfolioData = null;

        // Publish error but continue
        await userSyncProgressManager.publishProgress(userId, walletId, {
          walletId,
          progress: 35,
          status: 'syncing_assets',
          message: 'Portfolio sync failed, using cached data...',
        });
      }

      // Process and save portfolio data with transaction safety
      if (portfolioData) {
        await this.executeWithTransaction(
          async (tx) => await this.processPortfolioData(wallet.id, portfolioData, context, tx),
          'processPortfolioData'
        );
      }
      await job.updateProgress(50);

      // Check memory usage mid-process
      await this.checkMemoryUsage(context, initialMemory);

      let syncedDataTypes = ['portfolio'];

      if (fullSync) {
        // Publish transaction sync start
        await userSyncProgressManager.publishProgress(userId, walletId, {
          walletId,
          progress: 60,
          status: 'syncing_transactions',
          message: 'Fetching transaction history...',
        });

        // Sync transactions with better error handling
        try {
          const transactionData = await this.zerionService.getWalletTransactions(wallet.address);

          await userSyncProgressManager.publishProgress(userId, walletId, {
            walletId,
            progress: 75,
            status: 'syncing_transactions',
            message: 'Processing transaction data...',
          });

          await this.executeWithTransaction(
            async (tx) =>
              await this.processTransactionData(wallet.id, transactionData, context, tx),
            'processTransactionData'
          );
          syncedDataTypes.push('transactions');
          await job.updateProgress(70);
        } catch (error) {
          this.recordJobError(context, error, 'transaction_sync_failed');
          logger.warn('Transaction sync failed, continuing', {
            ...context,
            error: error instanceof Error ? error.message : String(error),
            errorCode: (error as any)?.code,
          });
        }

        // Sync positions with transaction safety
        try {
          const positionData = await this.zerionService.getWalletPositions(wallet.address);
          await this.executeWithTransaction(
            async (tx) => await this.processPositions(wallet.id, positionData, context, tx),
            'processPositions'
          );
          syncedDataTypes.push('positions');
          await job.updateProgress(85);
        } catch (error) {
          this.recordJobError(context, error, 'position_sync_failed');
          logger.warn('Position sync failed, continuing', {
            ...context,
            error: error instanceof Error ? error.message : String(error),
            errorCode: (error as any)?.code,
          });
        }
      }

      // Publish final progress
      await userSyncProgressManager.publishProgress(userId, walletId, {
        walletId,
        progress: 95,
        status: 'syncing',
        message: 'Finalizing sync...',
      });

      // Update wallet sync timestamp with transaction safety
      await this.executeWithTransaction(
        async (tx) => await this.updateWalletStatus(walletId, 'COMPLETED', context, tx),
        'completeWalletSync'
      );
      await job.updateProgress(100);

      // Final memory and performance check
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryDelta = finalMemory - initialMemory;

      logger.debug('Job memory usage analysis', {
        ...context,
        initialMemoryMB: Math.round(initialMemory / 1024 / 1024),
        finalMemoryMB: Math.round(finalMemory / 1024 / 1024),
        memoryDeltaMB: Math.round(memoryDelta / 1024 / 1024),
      });

      const result = {
        walletId,
        success: true,
        syncedAt: new Date(),
        dataTypes: syncedDataTypes,
        processingTime: Date.now() - context.startTime,
      };

      this.recordJobSuccess(context, result);
      logger.info('Wallet sync job completed successfully', { ...context, result });

      // Publish successful completion
      await userSyncProgressManager.publishCompleted(userId, walletId, {
        ...result,
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
        syncedData: syncedDataTypes,
        processingTimeMs: result.processingTime
      });

      return result;
    } catch (jobError) {
      const errorDetails = this.extractErrorDetails(jobError);

      logger.error('Wallet sync job failed', {
        ...context,
        ...errorDetails,
        processingTime: Date.now() - context.startTime,
      });

      // Update wallet sync status to failed with transaction safety
      await this.executeWithTransaction(
        async (tx) => await this.updateWalletStatus(walletId, 'FAILED', context, tx),
        'failWalletSync'
      ).catch((e) => logger.error('Failed to update wallet sync status', { ...context, error: e }));

      // Publish failure event
      await userSyncProgressManager.publishFailed(userId, walletId, {
        status: 'failed',
        progress: 0,
        error: (errorDetails as any).message || 'Unknown sync error',
        failedAt: new Date(),
        processingTimeMs: Date.now() - context.startTime
      });

      this.recordJobFailure(context, jobError);

      // Store error for finally block
      (context as any).jobError = jobError;
      throw jobError;
    } finally {
      this.activeJobs.delete(context.jobId);

      // Update job health metrics based on whether there was an error
      const hadError = !!(context as any).jobError;
      this.updateJobHealth('SYNC_WALLET', !hadError);

      // Force garbage collection if memory usage is high
      const currentMemory = process.memoryUsage().heapUsed;
      if (currentMemory > this.memoryThreshold * 0.8 && global.gc) {
        logger.debug('Triggering garbage collection due to high memory usage', {
          currentMemoryMB: Math.round(currentMemory / 1024 / 1024),
          hadError,
        });
        global.gc();
      }
    }
  }

  async processSyncWalletFull(job: Job<SyncWalletFullJobData>): Promise<any> {
    const {
      userId,
      walletId,
      syncAssets = true,
      syncTransactions = true,
      syncNFTs = true,
      syncDeFi = true,
      syncTypes,
    } = job.data;

    // Handle syncTypes array format
    const shouldSyncAssets = syncTypes ? syncTypes.includes('assets') : syncAssets;
    const shouldSyncTransactions = syncTypes
      ? syncTypes.includes('transactions')
      : syncTransactions;
    const shouldSyncNFTs = syncTypes ? syncTypes.includes('nfts') : syncNFTs;
    const shouldSyncDeFi = syncTypes ? syncTypes.includes('defi') : syncDeFi;

    // Debug logging for sync types
    console.log(`🔧 Sync configuration:`, {
      syncTypes,
      shouldSyncAssets,
      shouldSyncTransactions,
      shouldSyncNFTs,
      shouldSyncDeFi,
      hasZapperService: !!this.zapperService,
    });

    // Initialize API tracking
    const apiTracker = {
      totalRequests: 0,
      totalResponseTime: 0,
      totalDataSize: 0,
      successfulRequests: 0,
      failedRequests: 0,
      requestDetails: [] as Array<{
        endpoint: string;
        responseTime: number;
        dataSize: number;
        success: boolean;
        error?: string;
        timestamp: Date;
      }>,
      startTime: Date.now(),
    };

    const trackApiCall = async <T>(endpoint: string, apiCall: () => Promise<T>): Promise<T> => {
      const startTime = Date.now();
      apiTracker.totalRequests++;

      try {
        const result = await apiCall();
        const responseTime = Date.now() - startTime;
        const dataSize = JSON.stringify(result).length;

        apiTracker.totalResponseTime += responseTime;
        apiTracker.totalDataSize += dataSize;
        apiTracker.successfulRequests++;

        const requestDetail = {
          endpoint,
          responseTime,
          dataSize,
          success: true,
          timestamp: new Date(),
        };

        apiTracker.requestDetails.push(requestDetail);

        return result;
      } catch (error) {
        const responseTime = Date.now() - startTime;
        apiTracker.totalResponseTime += responseTime;
        apiTracker.failedRequests++;

        const requestDetail = {
          endpoint,
          responseTime,
          dataSize: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        };

        apiTracker.requestDetails.push(requestDetail);

        throw error;
      }
    };

    try {
      await job.updateProgress(0);

      // Publish sync started event
 /*      await userSyncProgressManager.publishProgress(userId, walletId, {
  
        walletId,
        progress: 0,
        status: 'queued',
        message: 'Full sync job queued',
        startedAt: new Date()
      }); */

      await userSyncProgressManager.broadcastWalletProgress(userId, walletId, {
        walletId,
        progress: 0,
        status: 'queued',
        message: 'Full sync job queued',
      });

      console.log(`🚀 Starting full wallet sync for ${this.maskAddress(walletId)}`);

      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet || !this.zerionService) {
        throw new CryptoServiceError(
          'Wallet not found or Zerion service unavailable',
          CryptoErrorCodes.WALLET_NOT_FOUND,
          404
        );
      }

      // Publish sync started with wallet info
      await userSyncProgressManager.publishProgress(userId, walletId, {
        walletId,
        progress: 10,
        status: 'syncing',
        message: `Starting sync for ${wallet.name} (${wallet.address.substring(0, 10)}...)`,
        startedAt: new Date()
      });

      const results: any = { walletId, syncedData: [], apiMetrics: {} };

      // Publish portfolio sync start
      await userSyncProgressManager.publishProgress(userId, walletId, {
        walletId,
        progress: 20,
        status: 'syncing_assets',
        message: 'Fetching portfolio data...',
      });

      // Track portfolio API call
      const portfolio = await trackApiCall('getWalletPortfolio', () =>
        this.zerionService!.getWalletPortfolio(wallet.address)
      );
      await this.processPortfolioData(wallet.id, portfolio);
      results.syncedData.push('portfolio');

      if (shouldSyncAssets) {
        const positions = await trackApiCall('getWalletPositions', () =>
          this.zerionService!.getWalletPositions(wallet.address)
        );
        console.log(`📊 Processing ${positions?.data?.length} asset positions`);
        await this.processPositions(wallet.id, positions?.data);
        results.syncedData.push('assets');
        await job.updateProgress(25);
      }

      if (shouldSyncTransactions) {
        // Publish transaction sync start
        await userSyncProgressManager.publishProgress(userId, walletId, {
          walletId,
          progress: 50,
          status: 'syncing_transactions',
          message: 'Fetching transaction history...',
        });

        // Get the last transaction timestamp from database for incremental sync
        const lastTransaction = await prisma.cryptoTransaction.findFirst({
          where: { walletId: wallet.id },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true, hash: true },
        });

        let transactionData;
        let syncType = 'full';

        if (lastTransaction) {
          // Incremental sync: fetch only transactions after the last one
          const lastTimestamp = lastTransaction.timestamp.toISOString();
          syncType = 'incremental';

          transactionData = await trackApiCall('getWalletTransactions (incremental)', () =>
            this.zerionService!.getWalletTransactions(wallet.address, {
              'filter[mined_at_gte]': lastTimestamp,
              sort: 'mined_at',
              'page[size]': 100, // Reasonable page size for incremental updates
            })
          );
        } else {
          // First-time sync: fetch recent transactions with limit
          syncType = 'first-time';

          transactionData = await trackApiCall('getWalletTransactions (first-time)', () =>
            this.zerionService!.getWalletTransactions(wallet.address, {
              sort: '-mined_at', // Most recent first
              'page[size]': 100, // Limit initial sync
            })
          );
        }

        // Log sync efficiency
        const fetchedCount = this.extractItemCount(transactionData);

        console.log(`💸 Processed ${fetchedCount} transactions (${syncType})`);
        await this.processTransactionData(wallet.id, transactionData);
        results.syncedData.push('transactions');
        results.transactionsSyncType = syncType;
        results.transactionsFetched = fetchedCount;
        await job.updateProgress(50);
      }

      if (shouldSyncNFTs && this.zapperService) {
        // Publish NFT sync start
        await userSyncProgressManager.publishProgress(userId, walletId, {
          walletId,
          progress: 70,
          status: 'syncing_nfts',
          message: 'Fetching NFT collections...',
        });

        try {
          // Track portfolio API call
          const nfts = await trackApiCall('getWalletNFTs', () =>
            this.zapperService!.getWalletNFTs([wallet.address])
          );

          const nftCount = nfts?.portfolioV2?.nftBalances?.totalTokensOwned || 0;
          console.log(`🖼️ Processing ${nftCount} NFTs`);

          // Process NFTs according to crypto_nfts schema
          await this.processZapperNFTs(wallet.id, nfts);

          results.syncedData.push('nfts');
          results.nftsSyncType = 'zapper';
          results.nftsFetched = nftCount;
        } catch (error) {
          logger.warn('NFT sync failed, continuing', {
            walletId: wallet.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        await job.updateProgress(75);
      } else if (shouldSyncNFTs && !this.zapperService) {
        console.log(`⚠️ NFT sync requested but Zapper service not available`);
      } else if (!shouldSyncNFTs) {
        console.log(`ℹ️ NFT sync skipped (not requested in syncTypes)`);
      }

      if (shouldSyncDeFi) {
        // DeFi position sync would go here
        results.syncedData.push('defi');
        await job.updateProgress(90);
      }

      // Publish final progress
      await userSyncProgressManager.publishProgress(userId, walletId, {
        walletId,
        progress: 95,
        status: 'syncing',
        message: 'Finalizing sync...',
      });

      await prisma.cryptoWallet.update({
        where: { id: walletId },
        data: {
          lastSyncAt: new Date(),
          syncStatus: 'COMPLETED',
        },
      });

      // Calculate final API metrics
      const totalSyncTime = Date.now() - apiTracker.startTime;
      const avgResponseTime =
        apiTracker.totalRequests > 0 ? apiTracker.totalResponseTime / apiTracker.totalRequests : 0;
      const totalDataSizeMB = apiTracker.totalDataSize / (1024 * 1024);

      results.apiMetrics = {
        totalRequests: apiTracker.totalRequests,
        successfulRequests: apiTracker.successfulRequests,
        failedRequests: apiTracker.failedRequests,
        successRate:
          apiTracker.totalRequests > 0
            ? (apiTracker.successfulRequests / apiTracker.totalRequests) * 100
            : 0,
        totalResponseTime: apiTracker.totalResponseTime,
        averageResponseTime: avgResponseTime,
        totalDataSizeMB: totalDataSizeMB,
        totalSyncTimeMs: totalSyncTime,
        requestDetails: apiTracker.requestDetails,
      };

      await job.updateProgress(100);

       await userSyncProgressManager.broadcastWalletCompleted(userId, walletId, {
   
        progress: 100,
        status: 'completed',
        message: 'Wallet Sync Complete',
      });

      console.log(`✅ Wallet sync completed - ${results.syncedData.join(', ')}`);

      logger.info(`Completed full wallet sync for wallet ${walletId}`, {
        ...results,
        apiMetrics: results.apiMetrics,
      });

      return results;
    } catch (error) {
      console.log(
        `❌ Wallet sync failed: ${error instanceof Error ? error.message : String(error)}`
      );
      const totalSyncTime = Date.now() - apiTracker.startTime;

      logger.error(`Full wallet sync failed for wallet ${walletId}:`, {
        error: error instanceof Error ? error.message : String(error),
        apiMetrics: {
          totalRequests: apiTracker.totalRequests,
          successfulRequests: apiTracker.successfulRequests,
          failedRequests: apiTracker.failedRequests,
          totalSyncTime,
          requestDetails: apiTracker.requestDetails,
        },
      });

      throw error;
    }
  }

  // ===============================
  // TRANSACTION SYNC JOBS
  // ===============================

  async processSyncTransactions(job: Job<SyncTransactionsJobData>): Promise<any> {
    const { userId, walletId, cursor } = job.data;

    try {
      await job.updateProgress(0);
      logger.info(`Starting transaction sync for wallet ${walletId}`);

      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet || !this.zerionService) {
        throw new CryptoServiceError(
          'Wallet not found or Zerion service unavailable',
          CryptoErrorCodes.WALLET_NOT_FOUND,
          404
        );
      }

      const options = cursor ? { cursor } : {};
      const transactionData = await this.zerionService.getWalletTransactions(
        wallet.address,
        options
      );

      await job.updateProgress(50);
      await this.processTransactionData(wallet.id, transactionData);
      await job.updateProgress(100);

      const result = {
        walletId,
        processedCount: transactionData?.data?.length || 0,
        hasMore: transactionData?.meta?.pagination?.has_next || false,
        nextCursor: transactionData?.meta?.pagination?.cursor,
      };

      logger.info(`Completed transaction sync for wallet ${walletId}`, result);
      return result;
    } catch (error) {
      logger.error(`Transaction sync failed for wallet ${walletId}:`, error);
      throw error;
    }
  }

  // ===============================
  // ANALYTICS JOBS
  // ===============================

  async processCalculatePortfolio(job: Job<CalculatePortfolioJobData>): Promise<any> {
    const { userId, walletId, includeAnalytics = false } = job.data;

    try {
      await job.updateProgress(0);
      logger.info(`Calculating portfolio for user ${userId}`, { walletId, includeAnalytics });

      let wallets;
      if (walletId) {
        wallets = await prisma.cryptoWallet.findMany({
          where: { id: walletId, userId },
        });
      } else {
        wallets = await prisma.cryptoWallet.findMany({
          where: { userId, isActive: true },
        });
      }

      await job.updateProgress(25);

      // Calculate portfolio totals
      const portfolioValue = await this.calculatePortfolioValue(wallets);
      await job.updateProgress(50);

      if (includeAnalytics && this.zerionService) {
        // Get analytics for each wallet
        for (const wallet of wallets) {
          try {
            const pnlData = await this.zerionService.getWalletPnL(wallet.address);
            await this.processPnLData(wallet.id, pnlData);
          } catch (error) {
            logger.warn(`Failed to get analytics for wallet ${wallet.id}:`, error);
          }
        }
        await job.updateProgress(80);
      }

      // Create snapshot if needed
      await this.createPortfolioSnapshot(userId, walletId, portfolioValue);
      await job.updateProgress(100);

      const result = {
        userId,
        walletId,
        portfolioValue,
        calculatedAt: new Date(),
      };

      logger.info(`Completed portfolio calculation for user ${userId}`, result);
      return result;
    } catch (error) {
      logger.error(`Portfolio calculation failed for user ${userId}:`, error);
      throw error;
    }
  }

  async processCreateSnapshot(job: Job<CreateSnapshotJobData>): Promise<any> {
    const { userId, walletId } = job.data;

    try {
      await job.updateProgress(0);
      logger.info(`Creating snapshot for user ${userId}`, { walletId });

      // Get current portfolio state
      const portfolioData = await this.getPortfolioSnapshot(userId, walletId);
      await job.updateProgress(50);

      // Save snapshot to database - for now just return the data
      // Would need to implement portfolioSnapshot model in schema
      const snapshot = {
        id: `snapshot_${Date.now()}`,
        userId,
        walletId,
        totalValueUsd: portfolioData.totalValue,
        assetCount: portfolioData.assetCount,
        snapshotData: portfolioData,
        createdAt: new Date(),
      };

      await job.updateProgress(100);

      logger.info(`Created snapshot ${snapshot.id} for user ${userId}`);
      return { snapshotId: snapshot.id, ...portfolioData };
    } catch (error) {
      logger.error(`Snapshot creation failed for user ${userId}:`, error);
      throw error;
    }
  }

  // ===============================
  // DATA PROCESSING HELPERS
  // ===============================

  private async processPortfolioData(
    walletId: string,
    portfolioData: any,
    context?: JobContext,
    _tx?: any
  ): Promise<void> {
    if (!portfolioData?.data) {
      logger.warn('No portfolio data to process', {
        walletId,
        context: context?.jobId,
        hasData: !!portfolioData,
        dataKeys: portfolioData ? Object.keys(portfolioData) : [],
      });
      return;
    }

    try {
      const portfolio = portfolioData.data;
      const attributes = portfolio.attributes || {};

      // Extract total portfolio value
      const totalValue = parseFloat(attributes.total?.positions || '0');

      // Extract position distribution by type
      const positionsByType = attributes.positions_distribution_by_type || {};
      const walletValue = parseFloat(positionsByType.wallet || '0');
      const depositedValue = parseFloat(positionsByType.deposited || '0');
      const borrowedValue = parseFloat(positionsByType.borrowed || '0');
      const lockedValue = parseFloat(positionsByType.locked || '0');
      const stakedValue = parseFloat(positionsByType.staked || '0');

      // Extract position distribution by chain
      const positionsByChain = attributes.positions_distribution_by_chain || {};
      const arbitrumValue = parseFloat(positionsByChain.arbitrum || '0');
      const avalancheValue = parseFloat(positionsByChain.avalanche || '0');
      const baseValue = parseFloat(positionsByChain.base || '0');
      const bscValue = parseFloat(positionsByChain['binance-smart-chain'] || '0');
      const celoValue = parseFloat(positionsByChain.celo || '0');
      const ethereumValue = parseFloat(positionsByChain.ethereum || '0');
      const fantomValue = parseFloat(positionsByChain.fantom || '0');
      const lineaValue = parseFloat(positionsByChain.linea || '0');
      const polygonValue = parseFloat(positionsByChain.polygon || '0');

      // Extract 24h changes
      const changes = attributes.changes || {};
      const absolute24hChange = changes.absolute_1d ? parseFloat(changes.absolute_1d) : null;
      const percent24hChange = changes.percent_1d ? parseFloat(changes.percent_1d) : null;

      logger.info('Processing portfolio data', {
        walletId,
        context: context?.jobId,
        totalValue,
        walletValue,
        stakedValue,
        absolute24hChange,
        percent24hChange,
        hasPositions: !!attributes.positions_distribution,
        attributeKeys: Object.keys(attributes).slice(0, 10),
      });

      const prismaClient = _tx || prisma;

      // Upsert portfolio data
      const portfolioPayload = {
        walletId,
        totalPositionsValue: totalValue,
        walletValue,
        depositedValue,
        borrowedValue,
        lockedValue,
        stakedValue,
        arbitrumValue,
        avalancheValue,
        baseValue,
        bscValue,
        celoValue,
        ethereumValue,
        fantomValue,
        lineaValue,
        polygonValue,
        absolute24hChange,
        percent24hChange,
        rawZerionData: portfolioData,
        lastSyncAt: new Date(),
        syncSource: 'zerion',
        updatedAt: new Date(),
      };

      // Upsert portfolio data with error handling
      try {
        await prismaClient.cryptoPortfolio.upsert({
          where: { walletId },
          create: {
            ...portfolioPayload,
            createdAt: new Date(),
          },
          update: portfolioPayload,
        });

        logger.debug('Successfully upserted portfolio data', {
          walletId: walletId.substring(0, 8) + '...',
          context: context?.jobId,
          totalValue,
          hasChanges: absolute24hChange !== null,
        });
      } catch (portfolioError) {
        logger.error('Failed to upsert portfolio data, continuing without portfolio table', {
          walletId: walletId.substring(0, 8) + '...',
          context: context?.jobId,
          error: portfolioError instanceof Error ? portfolioError.message : String(portfolioError),
          errorStack: portfolioError instanceof Error ? portfolioError.stack : undefined,
        });

        // Continue execution even if portfolio upsert fails
      }

      // Update wallet total value with validation and transaction safety
      if (isFinite(totalValue) && totalValue >= 0) {
        await prismaClient.cryptoWallet.update({
          where: { id: walletId },
          data: {
            totalBalanceUsd: totalValue,
            updatedAt: new Date(),
          },
        });

        logger.debug('Updated wallet and portfolio data', {
          walletId: walletId.substring(0, 8) + '...',
          context: context?.jobId,
          totalValue,
          portfolioComponents: {
            wallet: walletValue,
            deposited: depositedValue,
            staked: stakedValue,
          },
        });
      } else {
        logger.warn('Invalid total value, skipping wallet update but saving portfolio data', {
          walletId: walletId.substring(0, 8) + '...',
          context: context?.jobId,
          totalValue,
          originalValue: attributes.total?.positions,
          dataType: typeof totalValue,
        });
      }

      // Process positions if available with transaction safety
      if (attributes.positions_distribution) {
        await this.processPositions(walletId, attributes.positions_distribution, context, _tx);
      } else {
        logger.debug('No positions distribution found in portfolio data', {
          walletId: walletId.substring(0, 8) + '...',
          context: context?.jobId,
          availableAttributes: Object.keys(attributes),
        });
      }
    } catch (error) {
      logger.error('Error processing portfolio data', {
        walletId,
        context: context?.jobId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private async processPositions(
    walletId: string,
    positionsData: any,
    context?: JobContext,
    _tx?: any
  ): Promise<void> {
    if (!positionsData) {
      logger.warn('No positions data provided', {
        walletId,
        context: context?.jobId,
      });
      return;
    }

    // Handle ZerionPositionsResponse structure
    const positions = (positionsData.data || positionsData)?.filter(
      (pos: any) => pos?.attributes?.price > 0
    );

    if (!Array.isArray(positions)) {
      logger.warn('Invalid positions data structure - expected array', {
        walletId,
        context: context?.jobId,
        dataType: typeof positions,
        hasData: !!positionsData.data,
        keys: Object.keys(positionsData).slice(0, 5),
      });
      return;
    }

    let processedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let cachedAssetCount = 0;

    logger.info('Starting optimized position processing', {
      walletId,
      context: context?.jobId,
      positionCount: positions.length,
      cacheStats: this.assetCacheService.getCacheStats(),
    });

    // Phase 1: Extract and batch process unique assets
    const assetsToCreate = new Map<string, any>();
    const validPositions: Array<{
      position: any;
      assetKey: string;
      positionData: any;
      additionalMetadata: any;
    }> = [];
    const priceUpdates: Array<{
      assetKey: any;
      price?: number;
      priceUsd?: number;
    }> = [];

    console.log(`🔍 Parsing ${positions.length} positions for assets`);
    for (const position of positions) {
      try {
        if (position.type !== 'positions') {
          skippedCount++;
          continue;
        }

        const attributes = position.attributes;
        if (!attributes) {
          skippedCount++;
          continue;
        }

        const fungibleInfo = attributes.fungible_info;
        if (!fungibleInfo) {
          skippedCount++;
          continue;
        }

        // Extract chain information from relationships
        const chainId = position.relationships?.chain?.data?.id;
        const networkName = chainId ? this.mapChainIdToNetwork(chainId) : 'ETHEREUM';

        // Build asset data from fungible_info
        const assetData = {
          symbol: fungibleInfo.symbol || 'UNKNOWN',
          name: fungibleInfo.name || fungibleInfo.symbol || 'Unknown Asset',
          network: networkName,
          contractAddress: fungibleInfo.implementations?.[0]?.address || null,
          logoUrl: fungibleInfo.icon?.url || null,
          decimals: fungibleInfo.implementations?.[0]?.decimals || 18,
          type: this.determineAssetType(fungibleInfo),
          isVerified: !!fungibleInfo.verified,
        };

        const assetKey = `${assetData.symbol}_${assetData.network}_${assetData.contractAddress ?? 'native'}`;

        // Extract position data from attributes
        const quantity = attributes.quantity;
        const positionData = {
          balance: quantity?.float || this.parseFloat(quantity?.numeric, 0),
          balanceFormatted: quantity?.numeric || '0',
          balanceUsd: attributes.value || 0,
          dayChange: attributes?.changes?.absolute_1d || 0,
          dayChangePct: attributes?.changes?.percent_1d || 0,
        };

        const additionalMetadata = {
          positionType: attributes.position_type,
          isDisplayable: attributes.flags?.displayable || false,
          isTrash: attributes.flags?.is_trash || false,
          parent: attributes.parent,
          protocol: attributes.protocol,
          groupId: attributes.group_id,
          updatedAt: attributes.updated_at,
          updatedAtBlock: attributes.updated_at_block,
        };

        // Skip trash positions unless explicitly requested
        if (additionalMetadata.isTrash) {
          skippedCount++;
          continue;
        }

        // Check if asset exists in cache first
        const existingAsset = await this.assetCacheService.getAsset({
          symbol: assetData.symbol,
          network: assetData.network,
          contractAddress: assetData.contractAddress,
        });

        if (existingAsset) {
          cachedAssetCount++;
        } else {
          // Mark for batch creation
          assetsToCreate.set(assetKey, assetData);
        }

        // Store valid position for batch processing
        validPositions.push({
          position,
          assetKey,
          positionData,
          additionalMetadata,
        });

        // Collect price updates
        const priceUsd = attributes.price || 0;
        if (priceUsd > 0) {
          priceUpdates.push({
            assetKey: {
              symbol: assetData.symbol,
              network: assetData.network,
              contractAddress: assetData.contractAddress,
            },
            priceUsd,
          });
        }
      } catch (error) {
        errorCount++;
        logger.warn('Error parsing position data', {
          walletId,
          context: context?.jobId,
          positionId: position?.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Phase 2: Batch create new assets (fallback to old method during migration)
    if (assetsToCreate.size > 0) {
      logger.info('Creating new assets (fallback mode during migration)', {
        walletId,
        context: context?.jobId,
        assetCount: assetsToCreate.size,
      });

      try {
        // Try new batch method first
        await this.assetCacheService.batchFindOrCreateAssets(Array.from(assetsToCreate.values()));
      } catch (error) {
        logger.warn('Registry not available, using fallback asset creation', {
          walletId,
          context: context?.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback to old individual creation method
        for (const [, assetData] of assetsToCreate.entries()) {
          try {
            await this.findOrCreateAssetFallback(walletId, assetData, context, _tx);
          } catch (fallbackError) {
            logger.warn('Fallback asset creation failed', {
              walletId,
              assetSymbol: assetData.symbol,
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            });
          }
        }
      }
    }

    // Phase 3: Batch update asset prices
    if (priceUpdates.length > 0) {
      try {
        await this.assetCacheService.batchUpdatePrices(priceUpdates);
      } catch (error) {
        logger.warn('Batch price update failed', {
          walletId,
          context: context?.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Phase 4: Process positions with cached assets
    const batchSize = 20;
    for (let i = 0; i < validPositions.length; i += batchSize) {
      const batch = validPositions.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async ({ assetKey, positionData }) => {
          try {
            // Get asset from cache or fallback to old method
            const assetKeyParts = assetKey.split('_');
            if (assetKeyParts.length < 2) {
              logger.warn('Invalid asset key format', {
                assetKey,
                walletId,
                context: context?.jobId,
              });
              errorCount++;
              return;
            }

            const symbol = assetKeyParts[0]!;
            const network = assetKeyParts[1]! as any;
            const contractAddress: string | null =
              assetKeyParts[2] === 'native' ? null : assetKeyParts.slice(2).join('_');

            let asset = await this.assetCacheService.getAsset({
              symbol,
              network,
              contractAddress,
            });

            // Fallback to old asset lookup during migration
            if (!asset) {
              try {
                // @ts-ignore - Fallback to old crypto_assets table
                asset = await prisma.crypto_assets.findFirst({
                  where: {
                    symbol,
                    network,
                    contractAddress,
                  },
                });
              } catch (fallbackError) {
                logger.debug('Fallback asset lookup failed', {
                  symbol,
                  network,
                  contractAddress,
                  error:
                    fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                });
              }
            }

            if (asset) {
              await this.upsertPosition(walletId, asset.id, positionData, context, _tx);
              processedCount++;
            } else {
              errorCount++;
              logger.warn('Asset not found in cache or fallback table', {
                walletId,
                context: context?.jobId,
                assetKey: assetKey.substring(0, 50) + '...',
              });
            }
          } catch (error) {
            errorCount++;
            logger.warn('Error upserting position', {
              walletId,
              context: context?.jobId,
              assetKey: assetKey.substring(0, 50) + '...',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })
      );
    }

    const finalCacheStats = this.assetCacheService.getCacheStats();

    logger.info('Optimized position processing completed', {
      walletId,
      context: context?.jobId,
      total: positions.length,
      validPositions: validPositions.length,
      processedCount,
      errorCount,
      skippedCount,
      cachedAssetCount,
      newAssetsCreated: assetsToCreate.size,
      priceUpdatesApplied: priceUpdates.length,
      successRate:
        validPositions.length > 0
          ? ((processedCount / validPositions.length) * 100).toFixed(1)
          : '0',
      finalCacheStats,
    });
  }

  private async processTransactionData(
    walletId: string,
    transactionData: any,
    context?: JobContext,
    _tx?: any
  ): Promise<void> {
    if (!transactionData) {
      logger.warn('No transaction data to process', {
        walletId,
        context: context?.jobId,
        hasData: !!transactionData,
        dataKeys: transactionData ? Object.keys(transactionData) : [],
      });
      return;
    }

    const transactions = Array.isArray(transactionData) ? transactionData : [transactionData];
    let processedCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;

    logger.info('Starting transaction processing with enhanced schema', {
      walletId,
      context: context?.jobId,
      transactionCount: transactions.length,
    });

    for (const tx of transactions) {
      try {
        if (tx.type !== 'transactions') {
          logger.debug('Skipping non-transaction data', {
            walletId,
            context: context?.jobId,
            type: tx.type,
          });
          skippedCount++;
          continue;
        }

        if (!tx.attributes) {
          logger.debug('Skipping transaction without attributes', {
            walletId,
            context: context?.jobId,
            txKeys: Object.keys(tx),
          });
          skippedCount++;
          continue;
        }

        const attributes = tx.attributes;
        const hash = attributes.hash;
        if (!hash) {
          logger.warn('Transaction missing hash, skipping', {
            walletId,
            context: context?.jobId,
            txId: tx.id,
          });
          skippedCount++;
          continue;
        }

        // Extract chain information from relationships
        const chainId = tx.relationships?.chain?.data?.id;
        const network = chainId ? this.mapChainIdToNetwork(chainId) : 'ETHEREUM';

        // Check if transaction already exists with transaction safety
        const prismaClient = _tx || prisma;
        const existingTransaction = await prismaClient.cryptoTransaction.findFirst({
          where: {
            hash,
            network: network as any,
          },
        });

        // Process transfers to determine primary transfer for transaction data
        const transfers = attributes.transfers || [];
        const primaryTransfer = transfers[0]; // Use first transfer as primary

        // Process fees
        const fee = attributes.fee;
        const feeValueUsd = fee?.value || 0;
        const feePrice = fee?.price || 0;

        // Determine operation type and transaction type
        const operationType = attributes.operation_type;
        const transactionType = this.determineTransactionTypeFromAttributes(
          attributes,
          operationType
        );

        // Extract addresses - prioritize main transaction addresses over transfer addresses
        const fromAddress = attributes.sent_from || primaryTransfer?.sender || '';
        const toAddress = attributes.sent_to || primaryTransfer?.recipient || '';

        // Calculate transaction value and asset information
        let transactionValue = 0;
        let transactionValueUsd = 0;
        let assetSymbol = 'ETH';
        let assetContractAddress: string | null = null;

        if (primaryTransfer) {
          transactionValue =
            primaryTransfer.quantity?.float ||
            this.parseFloat(primaryTransfer.quantity?.numeric, 0);
          transactionValueUsd = primaryTransfer.value || 0;

          if (primaryTransfer.fungible_info) {
            assetSymbol = primaryTransfer.fungible_info.symbol || 'UNKNOWN';
            assetContractAddress =
              primaryTransfer.fungible_info.implementations?.[0]?.address || null;
          } else if (primaryTransfer.nft_info) {
            assetSymbol = 'NFT';
            assetContractAddress = primaryTransfer.nft_info.contract_address;
          }
        }

        // Process application metadata
        const appMetadata = attributes.application_metadata;
        const methodId = appMetadata?.method?.id;

        // Process acts for categorization
        const acts = attributes.acts || [];
        const category = this.determineCategoryFromActs(acts, operationType);
        const tags = this.generateTagsFromTransaction(attributes, acts);

        // Build comprehensive transaction data
        const txData = {
          walletId,
          hash,
          blockNumber: attributes.mined_at_block ? BigInt(attributes.mined_at_block) : null,
          transactionIndex: attributes.nonce || null,
          network: network as any,
          type: transactionType,
          status: this.mapTransactionStatus(attributes.status),
          timestamp: attributes.mined_at ? new Date(attributes.mined_at) : new Date(),
          fromAddress,
          toAddress,
          value: transactionValue,
          valueFormatted: primaryTransfer?.quantity?.numeric || '0',
          valueUsd: transactionValueUsd,
          gasUsed: null, // Not directly available in new schema
          gasPrice: feePrice,
          gasCost: fee?.quantity?.float || this.parseFloat(fee?.quantity?.numeric, 0),
          gasCostUsd: feeValueUsd,
          assetSymbol,
          assetContractAddress,
          methodId,
          inputData: null, // Would need to extract from raw transaction data
          logs: JSON.stringify({
            transfers: transfers.map((t: any) => ({
              direction: t.direction,
              value: t.value,
              asset: t.fungible_info?.symbol || t.nft_info?.name,
              sender: t.sender,
              recipient: t.recipient,
            })),
            approvals: attributes.approvals || [],
            acts: acts.map((act: any) => ({
              id: act.id,
              type: act.type,
              application: act.application_metadata?.name,
            })),
          }),
          internalTxs: transfers.length > 1 ? JSON.stringify(transfers.slice(1)) : null,
          parentTxHash: null, // Not available in current schema
          relatedTxHashes: [], // Could be determined from act_id relationships
          category,
          tags,
          notes: this.generateTransactionNotes(attributes, appMetadata),
        };

        if (!existingTransaction) {
          await prismaClient.cryptoTransaction.create({
            data: txData,
          });
          processedCount++;

          logger.debug('Created new transaction with enhanced data', {
            walletId: walletId.substring(0, 8) + '...',
            context: context?.jobId,
            hash: hash.substring(0, 10) + '...',
            type: transactionType,
            operationType,
            valueUsd: transactionValueUsd,
            transferCount: transfers.length,
            category,
            hasAppMetadata: !!appMetadata,
          });
        } else {
          // Update existing transaction with enhanced data
          await prismaClient.cryptoTransaction.update({
            where: { id: existingTransaction.id },
            data: {
              status: txData.status,
              valueUsd: txData.valueUsd,
              gasCostUsd: txData.gasCostUsd,
              logs: txData.logs,
              category: txData.category,
              tags: txData.tags,
              notes: txData.notes,
              updatedAt: new Date(),
            },
          });
          duplicateCount++;

          logger.debug('Updated existing transaction with enhanced data', {
            walletId: walletId.substring(0, 8) + '...',
            context: context?.jobId,
            hash: hash.substring(0, 10) + '...',
            status: txData.status,
            valueUsd: txData.valueUsd,
            category: txData.category,
          });
        }
      } catch (error) {
        errorCount++;
        logger.warn('Error processing individual transaction', {
          walletId,
          context: context?.jobId,
          error: error instanceof Error ? error.message : String(error),
          txHash: tx.attributes?.hash,
          txId: tx.id,
          operationType: tx.attributes?.operation_type,
        });
      }
    }

    logger.info('Transaction processing completed with enhanced schema', {
      walletId,
      context: context?.jobId,
      total: transactions.length,
      processedCount,
      duplicateCount,
      errorCount,
      skippedCount,
      successRate:
        transactions.length > 0
          ? ((processedCount / (transactions.length - skippedCount)) * 100).toFixed(1)
          : '0',
    });
  }

  private async processPnLData(
    walletId: string,
    pnlData: any,
    _context?: JobContext
  ): Promise<void> {
    // Process P&L data - implementation depends on Zerion API response structure
    logger.debug(`Processing P&L data for wallet ${walletId}`, pnlData);
    // Implementation would go here based on actual P&L data structure
  }

  private async processZapperNFTs(walletId: string, nfts: any): Promise<void> {
    if (!nfts?.portfolioV2?.nftBalances?.byToken?.edges) {
      logger.warn('No NFT data to process', { walletId });
      return;
    }

    const edges = nfts.portfolioV2.nftBalances.byToken.edges;
    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    logger.info('Starting NFT processing', {
      walletId: walletId.substring(0, 8) + '...',
      totalNFTs: edges.length,
    });

    for (const edge of edges) {
      try {
        const token = edge?.node?.token;
        const collection = token?.collection;

        if (!token || !collection) {
          skippedCount++;
          continue;
        }

        // Skip spam NFTs
        const spamScore = collection.spamScore || 0;
        if (spamScore == 100) {
          skippedCount++;
          continue;
        }

        // Map network name to blockchain network enum
        const networkName = String(collection.networkV2?.name || 'ethereum').toUpperCase();
        const network = this.mapNetworkNameToBlockchain(networkName);

        // Determine NFT standard based on network
        const standard = this.determineNFTStandard(network);

        // Extract NFT type from Zapper data
        const nftType = token.type || collection.type || 'GENERAL';
        const category = this.mapZapperNFTTypeToCategory(nftType);

        // Extract image URL from mediasV3
        const imageUrl =
          token.mediasV3?.images?.edges?.[0]?.node?.medium ||
          token.mediasV3?.images?.edges?.[0]?.node?.large ||
          null;

        // Extract animation URL if available
        const animationUrl =
          token.mediasV3?.videos?.edges?.[0]?.node?.medium ||
          token.mediasV3?.videos?.edges?.[0]?.node?.large ||
          null;

        // Extract attributes
        const attributes = token.attributes ? JSON.parse(JSON.stringify(token.attributes)) : null;

        // Extract pricing information
        const estimatedValue = parseFloat(token.estimatedValue?.valueUsd || '0');
        const floorPrice = parseFloat(collection.floorPrice || '0');
        const lastSalePrice = parseFloat(token.lastSale?.price || '0');

        const nftData = {
          walletId,
          contractAddress: collection.address,
          tokenId: token.tokenId,
          standard,
          network,
          name: token.name || 'Unnamed NFT',
          description: token.description || null,
          imageUrl,
          animationUrl,
          externalUrl: token.externalUrl || null,
          attributes: {
            zapperType: nftType,
            category: category,
            originalAttributes: attributes,
          },
          collectionName: collection.name || collection.displayName,
          collectionSymbol: collection.symbol || null,
          collectionSlug: collection.slug || null,
          ownerAddress: edge.node.owner || walletId, // Use actual owner address if available
          quantity: BigInt(edge.node.balance || 1),
          transferredAt: token.transferredAt ? new Date(token.transferredAt) : null,
          lastSalePrice: lastSalePrice > 0 ? lastSalePrice : null,
          lastSalePriceUsd: lastSalePrice > 0 ? lastSalePrice : null,
          floorPrice: floorPrice > 0 ? floorPrice : null,
          floorPriceUsd: floorPrice > 0 ? floorPrice : null,
          estimatedValue: estimatedValue > 0 ? estimatedValue : null,
          isSpam: spamScore >= 90, // Mark as spam if score is 50 or higher
          isNsfw: token.isNsfw || false,
          rarity: token.rarity?.rank ? `Rank ${token.rarity.rank}` : null,
          rarityRank: token.rarity?.rank || null,
        };

        // Upsert NFT record
        await prisma.cryptoNFT.upsert({
          where: {
            walletId_contractAddress_tokenId_network: {
              walletId,
              contractAddress: collection.address,
              tokenId: token.tokenId,
              network,
            },
          },
          create: {
            ...nftData,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          update: {
            ...nftData,
            updatedAt: new Date(),
          },
        });

        processedCount++;

        logger.debug('Processed NFT', {
          walletId: walletId.substring(0, 8) + '...',
          tokenId: token.tokenId,
          collectionName: collection.name,
          estimatedValue,
          isSpam: nftData.isSpam,
        });
      } catch (error) {
        errorCount++;
        logger.warn('Error processing NFT', {
          walletId: walletId.substring(0, 8) + '...',
          error: error instanceof Error ? error.message : String(error),
          tokenId: edge?.node?.token?.tokenId,
          collectionName: edge?.node?.token?.collection?.name,
        });
      }
    }

    // Update wallet NFT count
    await prisma.cryptoWallet.update({
      where: { id: walletId },
      data: {
        nftCount: processedCount,
        updatedAt: new Date(),
      },
    });

    logger.info('NFT processing completed', {
      walletId: walletId.substring(0, 8) + '...',
      total: edges.length,
      processedCount,
      skippedCount,
      errorCount,
      successRate: edges.length > 0 ? ((processedCount / edges.length) * 100).toFixed(1) : '0',
    });
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  // Job Context and Utility Methods
  private createJobContext(job: Job, jobType: string): JobContext {
    return {
      jobId: job.id ? String(job.id) : `job_${Date.now()}`,
      jobType,
      startTime: Date.now(),
      userId: (job.data as any).userId,
      walletId: (job.data as any).walletId,
    };
  }

  private canProcessJob(jobId: string, jobType: string): boolean {
    const memoryUsage = process.memoryUsage();
    const currentMemory = memoryUsage.heapUsed;

    // Check memory threshold
    if (currentMemory > this.memoryThreshold) {
      logger.warn('Memory threshold exceeded, rejecting new jobs', {
        currentMemoryMB: Math.round(currentMemory / 1024 / 1024),
        thresholdMB: Math.round(this.memoryThreshold / 1024 / 1024),
        activeJobs: this.activeJobs.size,
        rejectedJobId: jobId,
        jobType,
      });
      return false;
    }

    // Check concurrent job limit
    if (this.activeJobs.size >= this.maxConcurrentJobs) {
      logger.warn('Maximum concurrent jobs limit reached', {
        activeJobs: this.activeJobs.size,
        maxConcurrentJobs: this.maxConcurrentJobs,
        rejectedJobId: jobId,
        jobType,
        activeJobTypes: Array.from(this.activeJobs.values()).map((ctx) => ctx.jobType),
      });
      return false;
    }

    // Check job type health score
    const healthScore = this.jobHealthMetrics.get(jobType) || 1.0;
    if (healthScore < 0.3) {
      logger.warn('Job type health score too low, rejecting job', {
        jobType,
        healthScore,
        rejectedJobId: jobId,
      });
      return false;
    }

    return true;
  }

  private async getWalletWithRetry(
    walletId: string,
    userId: string,
    context: JobContext,
    retries = 3,
    _tx?: any
  ): Promise<any> {
    let lastError: any;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.debug('Attempting to fetch wallet', {
          ...context,
          attempt,
          maxRetries: retries,
          walletId: walletId.substring(0, 8) + '...',
          userId: userId.substring(0, 8) + '...',
        });

        const prismaClient = _tx || prisma;
        const wallet = await prismaClient.cryptoWallet.findFirst({
          where: { id: walletId, userId },
          include: {
            assets: { take: 1 }, // Include one asset to check if wallet has data
          },
        });

        if (!wallet) {
          const error = new CryptoServiceError(
            `Wallet ${walletId} not found for user ${userId}`,
            CryptoErrorCodes.WALLET_NOT_FOUND,
            404
          );
          logger.error('Wallet not found', { ...context, walletId, userId });
          throw error;
        }

        logger.debug('Successfully fetched wallet', {
          ...context,
          attempt,
          walletAddress: this.maskAddress(wallet.address),
          hasAssets: wallet.assets.length > 0,
        });

        return wallet;
      } catch (error) {
        lastError = error;

        if (attempt === retries) {
          logger.error('All wallet fetch attempts failed', {
            ...context,
            attempts: retries,
            finalError: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        const delay = 1000 * attempt + Math.random() * 500; // Add jitter
        logger.warn('Wallet fetch attempt failed, retrying', {
          ...context,
          attempt,
          error: error instanceof Error ? error.message : String(error),
          nextRetryDelayMs: delay,
        });

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private async updateWalletStatus(
    walletId: string,
    status: string,
    context: JobContext,
    tx?: any
  ): Promise<void> {
    try {
      logger.debug('Updating wallet status', {
        ...context,
        walletId: walletId.substring(0, 8) + '...',
        status,
        timestamp: new Date().toISOString(),
      });

      const prismaClient = tx || prisma;
      const updateData: any = {
        syncStatus: status,
        updatedAt: new Date(),
      };

      if (status === 'COMPLETED') {
        updateData.lastSyncAt = new Date();
      } else if (status === 'FAILED') {
        updateData.lastSyncError = `Job ${context.jobId} failed at ${new Date().toISOString()}`;
      }

      await prismaClient.cryptoWallet.update({
        where: { id: walletId },
        data: updateData,
      });

      // Clear cache when sync is completed to ensure fresh data on next request
      if (status === 'COMPLETED') {
        try {
          await cryptoService.clearWalletCache(walletId);
          await cryptoService.clearUserCache(context.userId);
          logger.info('Cache cleared after successful sync', {
            ...context,
            walletId: walletId.substring(0, 8) + '...',
          });
        } catch (cacheError) {
          logger.warn('Failed to clear cache after sync completion', {
            ...context,
            walletId: walletId.substring(0, 8) + '...',
            error: cacheError instanceof Error ? cacheError.message : String(cacheError),
          });
        }
      }

      logger.debug('Successfully updated wallet status', {
        ...context,
        walletId: walletId.substring(0, 8) + '...',
        status,
        updatedFields: Object.keys(updateData),
      });
    } catch (error) {
      logger.error('Failed to update wallet status', {
        ...context,
        walletId: walletId.substring(0, 8) + '...',
        status,
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
      });
      throw error;
    }
  }

  private async upsertPosition(
    walletId: string,
    assetId: string,
    positionData: any,
    context?: JobContext,
    tx?: any
  ): Promise<void> {
    try {
      const prismaClient = tx || prisma;

      logger.debug('Upserting position', {
        walletId: walletId.substring(0, 8) + '...',
        assetId: assetId.substring(0, 8) + '...',
        context: context?.jobId,
        balance: positionData.balance,
        balanceUsd: positionData.balanceUsd,
      });

      // Find existing position first
      const existingPosition = await prismaClient.cryptoPosition.findFirst({
        where: {
          walletId: walletId,
          assetId: assetId,
        },
      });

      if (existingPosition) {
        // Update existing position
        await prismaClient.cryptoPosition.update({
          where: { id: existingPosition.id },
          data: {
            ...positionData,
            updatedAt: new Date(),
          },
        });
      } else {
        // Create new position
        await prismaClient.cryptoPosition.create({
          data: {
            walletId,
            assetId,
            ...positionData,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      logger.debug('Successfully upserted position', {
        walletId: walletId.substring(0, 8) + '...',
        assetId: assetId.substring(0, 8) + '...',
        context: context?.jobId,
      });
    } catch (error) {
      logger.error('Failed to upsert position', {
        walletId: walletId.substring(0, 8) + '...',
        context: context?.jobId,
        assetId: assetId.substring(0, 8) + '...',
        error: error instanceof Error ? error.message : String(error),
        positionData,
      });
      throw error;
    }
  }

  private recordJobSuccess(context: JobContext, _result: any): void {
    const stats = this.stats.get(context.jobType);
    if (stats) {
      stats.totalProcessed++;
      stats.successful++;
      stats.lastProcessedAt = new Date();

      const processingTime = Date.now() - context.startTime;
      const currentMemory = process.memoryUsage().heapUsed;

      // Update processing time with exponential moving average
      const alpha = 0.1;
      stats.averageProcessingTime =
        stats.totalProcessed === 1
          ? processingTime
          : alpha * processingTime + (1 - alpha) * stats.averageProcessingTime;

      // Update memory usage statistics
      stats.peakMemoryUsage = Math.max(stats.peakMemoryUsage, currentMemory);
      stats.averageMemoryUsage =
        stats.totalProcessed === 1
          ? currentMemory
          : alpha * currentMemory + (1 - alpha) * stats.averageMemoryUsage;

      logger.debug('Recorded job success', {
        ...context,
        processingTimeMs: processingTime,
        memoryUsageMB: Math.round(currentMemory / 1024 / 1024),
        totalProcessed: stats.totalProcessed,
        successRate: stats.successful / stats.totalProcessed,
      });
    }
  }

  private recordJobFailure(context: JobContext, error: any): void {
    const stats = this.stats.get(context.jobType);
    if (stats) {
      stats.totalProcessed++;
      stats.failed++;
      stats.lastProcessedAt = new Date();

      // Track error breakdown
      const errorCode = (error as any)?.code || 'UNKNOWN_ERROR';
      stats.errorBreakdown[errorCode] = (stats.errorBreakdown[errorCode] || 0) + 1;

      const processingTime = Date.now() - context.startTime;
      const currentMemory = process.memoryUsage().heapUsed;

      // Update memory statistics even for failures
      stats.peakMemoryUsage = Math.max(stats.peakMemoryUsage, currentMemory);

      logger.warn('Recorded job failure', {
        ...context,
        errorCode,
        processingTimeMs: processingTime,
        memoryUsageMB: Math.round(currentMemory / 1024 / 1024),
        totalProcessed: stats.totalProcessed,
        failureRate: stats.failed / stats.totalProcessed,
        errorBreakdown: stats.errorBreakdown,
      });
    }
  }

  private extractErrorDetails(error: any): object {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: (error as any)?.code,
      errorType: error.constructor.name,
      statusCode: (error as any)?.statusCode || (error as any)?.response?.status,
    };
  }

  private parseFloat(value: any, defaultValue: number): number {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  private maskAddress(address: string): string {
    if (!address || address.length < 8) return address;
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractItemCount(result: any): number {
    try {
      if (!result) return 0;

      // Handle different response structures
      if (Array.isArray(result)) return result.length;
      if (result.data && Array.isArray(result.data)) return result.data.length;
      if (result.data && result.data.length !== undefined) return result.data.length;
      if (result.items && Array.isArray(result.items)) return result.items.length;
      if (result.results && Array.isArray(result.results)) return result.results.length;

      // For portfolio responses, count positions
      if (result.data && result.data.attributes && result.data.attributes.positions_distribution) {
        const positions = result.data.attributes.positions_distribution.data;
        return Array.isArray(positions) ? positions.length : 0;
      }

      // If we can't determine count, return 1 to indicate we got some data
      return typeof result === 'object' ? 1 : 0;
    } catch (error) {
      return 0;
    }
  }

  // Public methods
  getJobStats(): Map<string, JobStats> {
    return new Map(this.stats);
  }

  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  // New utility methods for enhanced functionality
  private async executeWithTransaction<T>(
    operation: (tx: any) => Promise<T>,
    operationName: string
  ): Promise<T> {
    try {
      return await prisma.$transaction(
        async (tx) => {
          logger.debug('Starting database transaction', { operationName });
          const result = await operation(tx);
          logger.debug('Database transaction completed successfully', { operationName });
          return result;
        },
        {
          maxWait: 10000, // 10 seconds
          timeout: 30000, // 30 seconds
        }
      );
    } catch (error) {
      logger.error('Database transaction failed', {
        operationName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async validateJobInputs(data: any, jobType: string): Promise<void> {
    const errors: string[] = [];

    if (jobType === 'SYNC_WALLET') {
      if (!data.userId || typeof data.userId !== 'string') {
        errors.push('Invalid or missing userId');
      }
      if (!data.walletId || typeof data.walletId !== 'string') {
        errors.push('Invalid or missing walletId');
      }
    }

    if (errors.length > 0) {
      const errorMessage = `Job validation failed: ${errors.join(', ')}`;
      logger.error('Job input validation failed', { jobType, errors, data });
      throw new CryptoServiceError(errorMessage, CryptoErrorCodes.INVALID_PARAMETERS, 400);
    }
  }

  private async checkMemoryUsage(context: JobContext, initialMemory: number): Promise<void> {
    const currentMemory = process.memoryUsage().heapUsed;
    const memoryDelta = currentMemory - initialMemory;

    if (memoryDelta > 100 * 1024 * 1024) {
      // 100MB increase
      logger.warn('Significant memory increase detected during job processing', {
        ...context,
        initialMemoryMB: Math.round(initialMemory / 1024 / 1024),
        currentMemoryMB: Math.round(currentMemory / 1024 / 1024),
        memoryDeltaMB: Math.round(memoryDelta / 1024 / 1024),
      });
    }
  }

  private recordJobError(context: JobContext, error: any, errorType: string): void {
    logger.error('Job encountered specific error', {
      ...context,
      errorType,
      error: error instanceof Error ? error.message : String(error),
      errorCode: (error as any)?.code,
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3) : undefined,
    });
  }

  private monitorMemoryUsage(): void {
    const memoryUsage = process.memoryUsage();
    const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const thresholdMB = Math.round(this.memoryThreshold / 1024 / 1024);

    if (memoryMB > thresholdMB * 0.8) {
      logger.warn('High memory usage detected', {
        currentMemoryMB: memoryMB,
        thresholdMB,
        utilizationPercent: Math.round((memoryMB / thresholdMB) * 100),
        activeJobs: this.activeJobs.size,
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
      });
    }
  }

  private cleanupStaleJobs(): void {
    const now = Date.now();
    const staleThreshold = 30 * 60 * 1000; // 30 minutes

    for (const [jobId, context] of this.activeJobs.entries()) {
      if (now - context.startTime > staleThreshold) {
        logger.warn('Removing stale job from active jobs', {
          jobId,
          jobType: context.jobType,
          ageMs: now - context.startTime,
          thresholdMs: staleThreshold,
        });
        this.activeJobs.delete(jobId);
      }
    }
  }

  private updateJobHealth(jobType: string, success: boolean): void {
    const currentHealth = this.jobHealthMetrics.get(jobType) || 1.0;
    const alpha = 0.1; // Weight for new data
    const newValue = success ? 1.0 : 0.0;
    const newHealth = alpha * newValue + (1 - alpha) * currentHealth;

    this.jobHealthMetrics.set(jobType, newHealth);

    if (newHealth < 0.5) {
      logger.warn('Job type health score declining', {
        jobType,
        healthScore: newHealth,
        recentSuccess: success,
      });
    }
  }

  // Enhanced metrics and monitoring
  getEnhancedJobStats(): {
    stats: Map<string, JobStats>;
    activeJobs: Array<{ jobId: string; jobType: string; ageMs: number }>;
    healthMetrics: Record<string, number>;
    memoryUsage: NodeJS.MemoryUsage;
    systemMetrics: {
      memoryThresholdMB: number;
      maxConcurrentJobs: number;
      currentActiveJobs: number;
    };
  } {
    const now = Date.now();
    const activeJobsInfo = Array.from(this.activeJobs.entries()).map(([jobId, context]) => ({
      jobId,
      jobType: context.jobType,
      ageMs: now - context.startTime,
    }));

    return {
      stats: new Map(this.stats),
      activeJobs: activeJobsInfo,
      healthMetrics: Object.fromEntries(this.jobHealthMetrics),
      memoryUsage: process.memoryUsage(),
      systemMetrics: {
        memoryThresholdMB: Math.round(this.memoryThreshold / 1024 / 1024),
        maxConcurrentJobs: this.maxConcurrentJobs,
        currentActiveJobs: this.activeJobs.size,
      },
    };
  }

  private async calculatePortfolioValue(wallets: any[]): Promise<number> {
    let totalValue = 0;

    for (const wallet of wallets) {
      try {
        const positions = await prisma.cryptoPosition.findMany({
          where: { walletId: wallet.id },
        });

        const walletValue = positions.reduce((sum, pos) => {
          const positionValue = pos.balanceUsd.toNumber();
          return sum + (isFinite(positionValue) ? positionValue : 0);
        }, 0);

        totalValue += walletValue;
      } catch (error) {
        logger.warn('Error calculating value for wallet', { walletId: wallet.id, error });
      }
    }

    return totalValue;
  }

  private async createPortfolioSnapshot(
    userId: string,
    walletId: string | undefined,
    portfolioValue: number
  ): Promise<void> {
    const snapshotData = {
      totalValue: portfolioValue,
      assetCount: 0, // Would calculate actual asset count
      timestamp: new Date(),
    };

    // For now, just log the snapshot data - would need to implement snapshot model
    logger.info(`Portfolio snapshot created for user ${userId}`, {
      walletId,
      portfolioValue,
      snapshotData,
    });
  }

  private async getPortfolioSnapshot(_userId: string, _walletId?: string): Promise<any> {
    // Get current portfolio state for snapshot
    return {
      totalValue: 0,
      assetCount: 0,
      timestamp: new Date(),
    };
  }

  // Mapping utilities
  // Legacy method - commented out as it's replaced by mapChainIdToNetwork
  // private mapNetworkFromZerion(zerionNetwork: string): string {
  //   const networkMap: Record<string, string> = {
  //     'ethereum': 'ETHEREUM',
  //     'polygon': 'POLYGON',
  //     'binance-smart-chain': 'BSC',
  //     'arbitrum': 'ARBITRUM',
  //     'optimism': 'OPTIMISM',
  //     'avalanche': 'AVALANCHE',
  //     'base': 'BASE',
  //     'solana': 'SOLANA',
  //     'bitcoin': 'BITCOIN',
  //   };
  //
  //   return networkMap[zerionNetwork] || 'ETHEREUM';
  // }

  private mapChainIdToNetwork(chainId: string): any {
    const chainIdMap: Record<string, string> = {
      ethereum: 'ETHEREUM',
      polygon: 'POLYGON',
      'binance-smart-chain': 'BSC',
      bsc: 'BSC',
      'arbitrum-one': 'ARBITRUM',
      arbitrum: 'ARBITRUM',
      optimism: 'OPTIMISM',
      avalanche: 'AVALANCHE',
      base: 'BASE',
      solana: 'SOLANA',
      bitcoin: 'BITCOIN',
      // Numeric chain IDs
      '1': 'ETHEREUM',
      '137': 'POLYGON',
      '56': 'BSC',
      '42161': 'ARBITRUM',
      '10': 'OPTIMISM',
      '43114': 'AVALANCHE',
      '8453': 'BASE',
    };

    return chainIdMap[chainId.toLowerCase()] || 'ETHEREUM';
  }

  private mapNetworkNameToBlockchain(networkName: string): any {
    const networkMap: Record<string, string> = {
      ETHEREUM: 'ETHEREUM',
      POLYGON: 'POLYGON',
      'BINANCE SMART CHAIN': 'BSC',
      BSC: 'BSC',
      ARBITRUM: 'ARBITRUM',
      'ARBITRUM ONE': 'ARBITRUM',
      OPTIMISM: 'OPTIMISM',
      AVALANCHE: 'AVALANCHE',
      BASE: 'BASE',
      SOLANA: 'SOLANA',
      BITCOIN: 'BITCOIN',
      FANTOM: 'FANTOM',
      CRONOS: 'CRONOS',
      GNOSIS: 'GNOSIS',
      AURORA: 'AURORA',
      CELO: 'CELO',
      MOONBEAM: 'MOONBEAM',
      KAVA: 'KAVA',
    };

    return networkMap[networkName] || 'ETHEREUM';
  }

  private determineNFTStandard(network: any): any {
    // Determine NFT standard based on network and contract analysis
    switch (network) {
      case 'SOLANA':
        return 'SOLANA_NFT';
      case 'BITCOIN':
        return 'BTC_ORDINALS';
      default:
        // For EVM chains, default to ERC721
        // In a real implementation, you would analyze the contract to determine if it's ERC721 or ERC1155
        return 'ERC721';
    }
  }

  private mapZapperNFTTypeToCategory(zapperType: string): string {
    const typeMap: Record<string, string> = {
      GENERAL: 'General',
      BRIDGED: 'Bridge',
      BADGE: 'Badge',
      POAP: 'POAP',
      TICKET: 'Ticket',
      ACCOUNT_BOUND: 'Soulbound',
      WRITING: 'Writing',
      GAMING: 'Gaming',
      ART_BLOCKS: 'Art',
      BRAIN_DROPS: 'Art',
      LENS_PROFILE: 'Social',
      LENS_FOLLOW: 'Social',
      LENS_COLLECT: 'Social',
      ZORA_ERC721: 'Art',
      ZORA_ERC1155: 'Art',
      BLUEPRINT: 'Blueprint',
    };

    return typeMap[zapperType.toUpperCase()] || 'General';
  }

  private determineAssetType(fungible: any): AssetType {
    // Logic to determine asset type based on token data
    if (fungible.symbol === 'ETH' || fungible.symbol === 'BTC') {
      return AssetType.COIN;
    }
    return AssetType.TOKEN;
  }

  private mapTransactionStatus(status: string): TransactionStatus {
    switch (status?.toLowerCase()) {
      case 'confirmed':
        return TransactionStatus.CONFIRMED;
      case 'failed':
        return TransactionStatus.FAILED;
      case 'pending':
        return TransactionStatus.PENDING;
      default:
        return TransactionStatus.PENDING;
    }
  }

  // Legacy method - keeping for backward compatibility but not used in new schema
  // private determineTransactionType(attributes: any): TransactionType {
  //   const transfers = attributes.transfers || [];
  //   if (transfers.length === 0) return TransactionType.CONTRACT_INTERACTION;
  //
  //   const hasReceive = transfers.some((t: any) => t.type === 'receive');
  //   const hasSend = transfers.some((t: any) => t.type === 'send');
  //
  //   if (hasReceive && hasSend) return TransactionType.SWAP;
  //   if (hasReceive) return TransactionType.RECEIVE;
  //   if (hasSend) return TransactionType.SEND;
  //
  //   return TransactionType.CONTRACT_INTERACTION;
  // }

  private determineTransactionTypeFromAttributes(
    attributes: any,
    operationType?: string
  ): TransactionType {
    // Use operation_type if available for more accurate categorization
    if (operationType) {
      switch (operationType.toLowerCase()) {
        case 'send':
          return TransactionType.SEND;
        case 'receive':
          return TransactionType.RECEIVE;
        case 'trade':
        case 'swap':
          return TransactionType.SWAP;
        case 'stake':
          return TransactionType.STAKE;
        case 'unstake':
          return TransactionType.UNSTAKE;
        case 'approve':
          return TransactionType.APPROVE;
        case 'mint':
          return TransactionType.MINT;
        case 'burn':
          return TransactionType.BURN;
        case 'claim':
          return TransactionType.CLAIM;
        case 'deposit':
          return TransactionType.LIQUIDITY_ADD;
        case 'withdraw':
          return TransactionType.LIQUIDITY_REMOVE;
        case 'execute':
        case 'deploy':
          return TransactionType.CONTRACT_INTERACTION;
        default:
          break;
      }
    }

    // Check for NFT transfers
    const transfers = attributes.transfers || [];
    const hasNFTTransfer = transfers.some((t: any) => t.nft_info);

    if (hasNFTTransfer) {
      // Determine if it's mint, burn or transfer based on addresses
      const hasZeroAddress = transfers.some(
        (t: any) =>
          t.sender === '0x0000000000000000000000000000000000000000' ||
          t.recipient === '0x0000000000000000000000000000000000000000'
      );

      if (hasZeroAddress) {
        const isMint = transfers.some(
          (t: any) => t.sender === '0x0000000000000000000000000000000000000000'
        );
        return isMint ? TransactionType.NFT_MINT : TransactionType.NFT_BURN;
      }
      return TransactionType.NFT_TRANSFER;
    }

    // Fallback to transfer-based logic for fungible tokens
    if (transfers.length === 0) {
      return TransactionType.CONTRACT_INTERACTION;
    }

    // Check transfer directions
    const hasIncoming = transfers.some((t: any) => t.direction === 'in');
    const hasOutgoing = transfers.some((t: any) => t.direction === 'out');
    const hasSelf = transfers.some((t: any) => t.direction === 'self');

    if (hasSelf) return TransactionType.CONTRACT_INTERACTION; // Self transfers are usually contract interactions
    if (hasIncoming && hasOutgoing) return TransactionType.SWAP;
    if (hasIncoming) return TransactionType.RECEIVE;
    if (hasOutgoing) return TransactionType.SEND;

    return TransactionType.CONTRACT_INTERACTION;
  }

  private determineCategoryFromActs(acts: any[], operationType?: string): string | null {
    if (!acts || acts.length === 0) {
      // Fallback to operation type
      if (operationType) {
        const categoryMap: Record<string, string> = {
          trade: 'DEX',
          swap: 'DEX',
          stake: 'DeFi',
          unstake: 'DeFi',
          deposit: 'DeFi',
          withdraw: 'DeFi',
          borrow: 'DeFi',
          repay: 'DeFi',
          mint: 'DeFi',
          burn: 'DeFi',
        };
        return categoryMap[operationType.toLowerCase()] || null;
      }
      return null;
    }

    // Determine category from acts
    for (const act of acts) {
      const actType = act.type?.toLowerCase();
      const appName = act.application_metadata?.name?.toLowerCase();

      // Check for DeFi protocols
      if (appName) {
        if (
          ['uniswap', 'sushiswap', 'pancakeswap', '1inch', 'dex'].some((dex) =>
            appName.includes(dex)
          )
        ) {
          return 'DEX';
        }
        if (
          ['aave', 'compound', 'maker', 'yearn', 'curve'].some((defi) => appName.includes(defi))
        ) {
          return 'DeFi';
        }
        if (['opensea', 'blur', 'looksrare', 'nft'].some((nft) => appName.includes(nft))) {
          return 'NFT';
        }
        if (['ethereum name service', 'ens'].some((ens) => appName.includes(ens))) {
          return 'Domain';
        }
      }

      // Check by act type
      switch (actType) {
        case 'trade':
        case 'swap':
          return 'DEX';
        case 'deposit':
        case 'withdraw':
        case 'stake':
        case 'unstake':
          return 'DeFi';
        case 'mint':
        case 'burn':
          return acts.some((a) => a.application_metadata?.name?.toLowerCase().includes('nft'))
            ? 'NFT'
            : 'DeFi';
        default:
          break;
      }
    }

    return 'DeFi'; // Default for complex transactions
  }

  private generateTagsFromTransaction(attributes: any, acts: any[]): string[] {
    const tags: string[] = [];

    // Add operation type as tag
    if (attributes.operation_type) {
      tags.push(attributes.operation_type.toLowerCase());
    }

    // Add tags from acts
    for (const act of acts) {
      if (act.type) {
        tags.push(act.type.toLowerCase());
      }

      // Add application name as tag
      if (act.application_metadata?.name) {
        const appName = act.application_metadata.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        if (appName && appName.length > 0) {
          tags.push(appName);
        }
      }
    }

    // Add transfer-based tags
    const transfers = attributes.transfers || [];
    const hasNFT = transfers.some((t: any) => t.nft_info);
    const hasMultipleAssets =
      new Set(transfers.map((t: any) => t.fungible_info?.symbol || t.nft_info?.contract_address))
        .size > 1;

    if (hasNFT) tags.push('nft');
    if (hasMultipleAssets) tags.push('multi_asset');
    if (transfers.length > 2) tags.push('complex');

    // Add special flags
    if (attributes.flags?.is_trash) tags.push('spam');

    // Remove duplicates and limit to reasonable number
    return [...new Set(tags)].slice(0, 10);
  }

  private generateTransactionNotes(attributes: any, appMetadata?: any): string | null {
    const notes: string[] = [];

    // Add application information
    if (appMetadata?.name) {
      notes.push(`Application: ${appMetadata.name}`);
    }

    // Add method information
    if (appMetadata?.method?.name) {
      notes.push(`Method: ${appMetadata.method.name}`);
    }

    // Add transfer summary for complex transactions
    const transfers = attributes.transfers || [];
    if (transfers.length > 1) {
      const transferSummary = transfers
        .map((t: any, index: number) => {
          const asset = t.fungible_info?.symbol || t.nft_info?.name || 'Unknown';
          const direction = t.direction;
          const value = t.quantity?.numeric || 'unknown';
          return `${index + 1}. ${direction}: ${value} ${asset}`;
        })
        .join('; ');

      if (transferSummary.length < 500) {
        // Avoid too long notes
        notes.push(`Transfers: ${transferSummary}`);
      } else {
        notes.push(`Complex transaction with ${transfers.length} transfers`);
      }
    }

    // Add approval information
    const approvals = attributes.approvals || [];
    if (approvals.length > 0) {
      notes.push(`Approvals: ${approvals.length} token approval(s)`);
    }

    const collectionApprovals = attributes.collection_approvals || [];
    if (collectionApprovals.length > 0) {
      notes.push(`Collection Approvals: ${collectionApprovals.length} NFT collection approval(s)`);
    }

    return notes.length > 0 ? notes.join(' | ') : null;
  }

  // Temporary fallback method during migration
  private async findOrCreateAssetFallback(
    walletId: string,
    assetData: any,
    context?: JobContext,
    tx?: any
  ): Promise<any> {
    try {
      const prismaClient = tx || prisma;

      // @ts-ignore - Using old crypto_assets table during migration
      let asset = await prismaClient.crypto_assets.findFirst({
        where: {
          symbol: assetData.symbol,
          network: assetData.network,
          contractAddress: assetData.contractAddress,
        },
      });

      if (!asset) {
        logger.debug('Creating new asset (fallback)', {
          walletId: walletId.substring(0, 8) + '...',
          context: context?.jobId,
          symbol: assetData.symbol,
          network: assetData.network,
        });

        // @ts-ignore - Using old crypto_assets table during migration
        asset = await prismaClient.crypto_assets.create({
          data: {
            ...assetData,
            type: assetData.type || this.determineAssetType({ symbol: assetData.symbol }),
            priceUsd: 0,
            walletId: walletId,
          },
        });
      }

      return asset;
    } catch (error) {
      logger.error('Failed to find or create asset (fallback)', {
        walletId: walletId.substring(0, 8) + '...',
        context: context?.jobId,
        assetData: {
          symbol: assetData.symbol,
          network: assetData.network,
          contractAddress: assetData.contractAddress,
        },
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

// ===============================
// WORKER SETUP
// ===============================

export function initializeCryptoWorkers(): void {
  const processor = CryptoJobProcessor.getInstance();

  // Check if Redis connection is configured
  const redisUrl = process.env['REDIS_URL'];
  const redisHost = process.env['REDIS_HOST'];

  if (!redisUrl && !redisHost) {
    logger.warn('Redis not configured - crypto workers will not be initialized');
    return;
  }

  const connectionConfig: any = {
    host: redisHost || 'localhost',
    port: parseInt(process.env['REDIS_PORT'] || '6379'),
    db: parseInt(process.env['REDIS_DB'] || '0'),
  };

  if (process.env['REDIS_PASSWORD']) {
    connectionConfig.password = process.env['REDIS_PASSWORD'];
  }

  if (redisUrl) {
    connectionConfig.url = redisUrl;
  }

  try {
    // Crypto Sync Worker
    const cryptoSyncWorker = new Worker(
      QUEUE_NAMES.CRYPTO_SYNC,
      async (job: Job) => {
        switch (job.name) {
          case JOB_TYPES.SYNC_WALLET:
            return await processor.processSyncWallet(job);
          case JOB_TYPES.SYNC_WALLET_FULL:
            return await processor.processSyncWalletFull(job);
          case JOB_TYPES.SYNC_TRANSACTIONS:
            return await processor.processSyncTransactions(job);
          default:
            throw new Error(`Unknown job type: ${job.name}`);
        }
      },
      {
        connection: connectionConfig,
        concurrency: 3,
        limiter: {
          max: 10,
          duration: 60000, // 10 jobs per minute
        },
      }
    );

    // Analytics Worker
    const cryptoAnalyticsWorker = new Worker(
      QUEUE_NAMES.CRYPTO_ANALYTICS,
      async (job: Job) => {
        switch (job.name) {
          case JOB_TYPES.CALCULATE_PORTFOLIO:
            return await processor.processCalculatePortfolio(job);
          case JOB_TYPES.CREATE_SNAPSHOT:
            return await processor.processCreateSnapshot(job);
          default:
            throw new Error(`Unknown job type: ${job.name}`);
        }
      },
      {
        connection: connectionConfig,
        concurrency: 2,
      }
    );

    // Add workers to queue manager
    queueManager.addWorker(QUEUE_NAMES.CRYPTO_SYNC, cryptoSyncWorker);
    queueManager.addWorker(QUEUE_NAMES.CRYPTO_ANALYTICS, cryptoAnalyticsWorker);

    // Worker event handlers
    cryptoSyncWorker.on('completed', (job, result) => {
      logger.info(`Crypto sync job ${job.id} completed`, { result });
    });

    cryptoSyncWorker.on('failed', (job, error) => {
      logger.error(`Crypto sync job ${job?.id} failed:`, error);
    });

    cryptoAnalyticsWorker.on('completed', (job, result) => {
      logger.info(`Analytics job ${job.id} completed`, { result });
    });

    cryptoAnalyticsWorker.on('failed', (job, error) => {
      logger.error(`Analytics job ${job?.id} failed:`, error);
    });

    logger.info('Crypto job workers initialized successfully', {
      syncWorkerConcurrency: 3,
      analyticsWorkerConcurrency: 2,
      rateLimitMax: 8,
      rateLimitDuration: 60000,
    });
  } catch (error) {
    logger.error('Failed to initialize crypto workers', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// Export processor instance for external access
export function getCryptoJobProcessor(): CryptoJobProcessor {
  return CryptoJobProcessor.getInstance();
}
