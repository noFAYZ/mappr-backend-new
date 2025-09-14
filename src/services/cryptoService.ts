import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { BlockchainNetwork, AssetType } from '@prisma/client';
import Redis from 'ioredis';
import { createZerionService, ZerionService } from '@/services/zerionService';
import { createZapperService, ZapperService } from '@/services/zapperService';
import { cryptoSyncQueue, cryptoAnalyticsQueue, JOB_TYPES } from '@/config/queue';
import {
  CryptoWalletRequest,
  UpdateWalletRequest,
  PortfolioSummary,
  AssetBalance,
  CryptoTransactionFilters,
  PaginationOptions,
  PaginatedResponse,
  NFTFilters,
  DeFiPositionFilters,
  CryptoServiceError,
  CryptoErrorCodes,
  CacheKeys,
  ZapperWalletData,
  ZapperSyncOptions,
} from '@/types/crypto';

export class CryptoService {
  private zerionService: ZerionService | null = null;
  private zapperService: ZapperService | null = null;
  private redis: Redis | null = null;
  private primaryProvider: 'zapper' | 'zerion' = 'zapper';
  private fallbackProvider: 'zapper' | 'zerion' = 'zerion';

  constructor() {
    // Set provider preferences from environment
    this.primaryProvider =
      (process.env['CRYPTO_PRIMARY_PROVIDER'] as 'zapper' | 'zerion') || 'zapper';
    this.fallbackProvider =
      (process.env['CRYPTO_FALLBACK_PROVIDER'] as 'zapper' | 'zerion') || 'zerion';
    // Initialize Zerion SDK
    const zerionApiKey = process.env['ZERION_API_KEY'];
    if (!zerionApiKey) {
      logger.warn(
        'ZERION_API_KEY environment variable not set. Service will have limited functionality.'
      );
    } else {
      try {
        this.zerionService = createZerionService({ apiKey: zerionApiKey });
        logger.info('Zerion service initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize Zerion service:', error);
        logger.warn('Service will have limited functionality without external data sources');
      }
    }

    // Initialize Zapper SDK
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

    // Initialize Redis for caching (only if REDIS_URL is provided)
    const redisUrl = process.env['REDIS_URL'];

    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl);
        logger.info('Redis client initialized for crypto service');
      } catch (error) {
        logger.error('Failed to initialize Redis:', error);
        this.redis = null;
        logger.warn('Continuing without Redis - caching will be disabled');
      }
    } else {
      logger.warn('REDIS_URL not configured - caching will be disabled');
    }
  }

  // ===============================
  // WALLET MANAGEMENT
  // ===============================

  async addWallet(userId: string, walletData: CryptoWalletRequest) {
    try {
      // Validate wallet address format
      if (!this.isValidAddress(walletData.address, walletData.network)) {
        throw new CryptoServiceError(
          'Invalid wallet address format',
          CryptoErrorCodes.INVALID_ADDRESS,
          400
        );
      }

      // Check if wallet already exists for this user
      const existingWallet = await prisma.cryptoWallet.findUnique({
        where: {
          userId_address_network: {
            userId,
            address: walletData.address,
            network: walletData.network,
          },
        },
      });

      if (existingWallet) {
        throw new CryptoServiceError(
          'Wallet already exists for this user',
          CryptoErrorCodes.DUPLICATE_WALLET,
          400
        );
      }

      // Create wallet in database
      const wallet = await prisma.cryptoWallet.create({
        data: {
          userId,
          name: walletData.name,
          address: walletData.address,
          type: walletData.type,
          network: walletData.network,
          label: walletData.label || null,
          notes: walletData.notes || null,
          tags: walletData.tags || [],
        },
        include: {
          user: true,
        },
      });

      // Initialize wallet sync in background
      await this.scheduleWalletSync(userId, wallet.id, true);

      // Clear cache to ensure fresh data
      await this.clearWalletCache(wallet.id);
      await this.clearUserCache(userId);

      logger.info(
        `Crypto wallet added for user ${userId}: ${walletData.address} on ${walletData.network}`
      );
      return wallet;
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error adding crypto wallet:', error);
      throw new AppError('Failed to add crypto wallet', 500);
    }
  }

  async removeWallet(userId: string, walletId: string) {
    try {
      // Check if wallet exists and belongs to user
      const wallet = await prisma.cryptoWallet.findFirst({
        where: {
          id: walletId,
          userId,
        },
      });

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      // Delete wallet and all related data
      await prisma.cryptoWallet.delete({
        where: { id: walletId },
      });

      // Clear cache
      await this.clearWalletCache(walletId);

      logger.info(`Crypto wallet removed for user ${userId}: ${walletId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error removing crypto wallet:', error);
      throw new AppError('Failed to remove crypto wallet', 500);
    }
  }

  async updateWallet(userId: string, walletId: string, updateData: UpdateWalletRequest) {
    try {
      // Check if wallet exists and belongs to user
      const wallet = await prisma.cryptoWallet.findFirst({
        where: {
          id: walletId,
          userId,
        },
      });

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      // Filter out undefined values and construct proper update data
      const cleanedUpdateData: any = {};
      if (updateData.name !== undefined) cleanedUpdateData.name = updateData.name;
      if (updateData.label !== undefined) cleanedUpdateData.label = updateData.label;
      if (updateData.notes !== undefined) cleanedUpdateData.notes = updateData.notes;
      if (updateData.tags !== undefined) cleanedUpdateData.tags = updateData.tags;
      if (updateData.isActive !== undefined) cleanedUpdateData.isActive = updateData.isActive;
      if (updateData.isWatching !== undefined) cleanedUpdateData.isWatching = updateData.isWatching;

      // Update wallet
      const updatedWallet = await prisma.cryptoWallet.update({
        where: { id: walletId },
        data: cleanedUpdateData,
      });

      // Clear cache if watching status changed
      if (updateData.isWatching !== undefined) {
        await this.clearWalletCache(walletId);
      }

      logger.info(`Crypto wallet updated for user ${userId}: ${walletId}`);
      return updatedWallet;
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error updating crypto wallet:', error);
      throw new AppError('Failed to update crypto wallet', 500);
    }
  }

  async getUserWallets(userId: string) {
    try {
      const wallets = await prisma.cryptoWallet.findMany({
        where: {
          userId,
          isActive: true,
        },
        include: {
          _count: {
            select: {
              nfts: true,
              transactions: true,
            },
          },
        },
        orderBy: [{ totalBalanceUsd: 'desc' }, { createdAt: 'desc' }],
      });

      return wallets;
    } catch (error) {
      logger.error('Error fetching user wallets:', error);
      throw new AppError('Failed to fetch crypto wallets', 500);
    }
  }

  async resolveWallet(userId: string, walletId?: string, address?: string) {
    try {
      let wallet;

      if (walletId) {
        // Find by wallet ID
        wallet = await prisma.cryptoWallet.findFirst({
          where: { id: walletId, userId },
        });
      } else if (address) {
        // Find by address
        wallet = await prisma.cryptoWallet.findFirst({
          where: {
            address: address.toLowerCase(),
            userId,
          },
        });
      } else {
        throw new AppError('Either walletId or address must be provided', 400);
      }

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      return wallet;
    } catch (error) {
      if (error instanceof AppError || error instanceof CryptoServiceError) {
        throw error;
      }
      logger.error('Error resolving wallet:', error);
      throw new AppError('Failed to resolve wallet', 500);
    }
  }

  // ===============================
  // UNIFIED PROVIDER METHODS
  // ===============================

  private async getWalletDataFromProvider(
    address: string,
    provider: 'zapper' | 'zerion'
  ): Promise<any> {
    try {
      if (provider === 'zapper' && this.zapperService) {
        // Use individual Zapper methods for better performance
        const [assets, nfts, transactions] = await Promise.all([
          this.zapperService.getWalletAssets([address]),
          this.zapperService.getWalletNFTs([address]),
          this.zapperService.getWalletTransactions([address], 20),
        ]);

        return {
          provider: 'zapper',
          data: { assets, nfts, transactions },
        };
      } else if (provider === 'zerion' && this.zerionService) {
        const portfolioData = await this.zerionService.getWalletPortfolio(address);
        return {
          provider: 'zerion',
          data: portfolioData,
        };
      } else {
        throw new Error(`Provider ${provider} not available`);
      }
    } catch (error) {
      logger.warn(`Failed to get wallet data from ${provider}:`, error);
      throw error;
    }
  }

  async getUnifiedWalletPortfolio(address: string): Promise<any> {
    try {
      // Try primary provider first
      try {
        const result = await this.getWalletDataFromProvider(address, this.primaryProvider);
        logger.info(
          `Successfully fetched wallet portfolio from primary provider (${this.primaryProvider})`
        );
        return result;
      } catch (primaryError) {
        logger.warn(
          `Primary provider (${this.primaryProvider}) failed, trying fallback:`,
          primaryError
        );

        // Try fallback provider
        if (this.fallbackProvider !== this.primaryProvider) {
          const result = await this.getWalletDataFromProvider(address, this.fallbackProvider);
          logger.info(
            `Successfully fetched wallet portfolio from fallback provider (${this.fallbackProvider})`
          );
          return result;
        } else {
          throw primaryError;
        }
      }
    } catch (error) {
      logger.error(`Both providers failed to fetch wallet portfolio for ${address}:`, error);
      throw new CryptoServiceError(
        'Unable to fetch wallet data from any provider',
        CryptoErrorCodes.EXTERNAL_API_ERROR,
        503
      );
    }
  }

  async getUnifiedWalletTransactions(address: string, limit = 20): Promise<any> {
    try {
      // Try primary provider first
      try {
        let result;
        if (this.primaryProvider === 'zapper' && this.zapperService) {
          const data = await this.zapperService.getWalletTransactions([address], limit);
          result = { provider: 'zapper', data };
        } else if (this.primaryProvider === 'zerion' && this.zerionService) {
          const data = await this.zerionService.getWalletTransactions(address);
          result = { provider: 'zerion', data };
        } else {
          throw new Error(`Primary provider ${this.primaryProvider} not available`);
        }

        logger.info(
          `Successfully fetched wallet transactions from primary provider (${this.primaryProvider})`
        );
        return result;
      } catch (primaryError) {
        logger.warn(
          `Primary provider (${this.primaryProvider}) failed for transactions, trying fallback:`,
          primaryError
        );

        // Try fallback provider
        if (this.fallbackProvider !== this.primaryProvider) {
          let result;
          if (this.fallbackProvider === 'zapper' && this.zapperService) {
            const data = await this.zapperService.getWalletTransactions([address], limit);
            result = { provider: 'zapper', data };
          } else if (this.fallbackProvider === 'zerion' && this.zerionService) {
            const data = await this.zerionService.getWalletTransactions(address);
            result = { provider: 'zerion', data };
          } else {
            throw new Error(`Fallback provider ${this.fallbackProvider} not available`);
          }

          logger.info(
            `Successfully fetched wallet transactions from fallback provider (${this.fallbackProvider})`
          );
          return result;
        } else {
          throw primaryError;
        }
      }
    } catch (error) {
      logger.error(`Both providers failed to fetch wallet transactions for ${address}:`, error);
      throw new CryptoServiceError(
        'Unable to fetch wallet transactions from any provider',
        CryptoErrorCodes.EXTERNAL_API_ERROR,
        503
      );
    }
  }

  async getProviderStatus(): Promise<{
    primary: { provider: string; available: boolean; healthy: boolean };
    fallback: { provider: string; available: boolean; healthy: boolean };
  }> {
    const checkProvider = async (provider: 'zapper' | 'zerion') => {
      let available = false;
      let healthy = false;

      try {
        if (provider === 'zapper' && this.zapperService) {
          available = true;
          const healthCheck = await this.zapperService.healthCheck();
          healthy = healthCheck.healthy;
        } else if (provider === 'zerion' && this.zerionService) {
          available = true;
          const healthCheck = await this.zerionService.healthCheck();
          healthy = healthCheck.healthy;
        }
      } catch (error) {
        logger.warn(`Health check failed for ${provider}:`, error);
      }

      return { provider, available, healthy };
    };

    const [primary, fallback] = await Promise.all([
      checkProvider(this.primaryProvider),
      checkProvider(this.fallbackProvider),
    ]);

    return { primary, fallback };
  }

  // ===============================
  // PORTFOLIO DATA
  // ===============================

  async getWalletPortfolio(userId: string, walletId: string): Promise<any> {
    try {
      const cacheKey = `${CacheKeys.WALLET_PORTFOLIO}:${walletId}`;
      let cached = null;
      let useCache = true;

      // Check if wallet was recently added (within last 10 minutes) - skip cache for fresh wallets
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
        select: { createdAt: true, syncStatus: true },
      });

      if (wallet) {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const isRecentlyAdded = wallet.createdAt > tenMinutesAgo;
        const isSyncing = wallet.syncStatus === 'IN_PROGRESS';

        // Skip cache if wallet is recently added or currently syncing
        if (isRecentlyAdded || isSyncing) {
          useCache = false;
          logger.info(
            `Skipping cache for wallet ${walletId} - recently added: ${isRecentlyAdded}, syncing: ${isSyncing}`
          );
        }
      }

      if (useCache && this.redis) {
        try {
          cached = await this.redis.get(cacheKey);
        } catch (error) {
          logger.warn('Redis cache read failed:', error);
        }
      }

      if (cached && useCache) {
        const parsedCache = JSON.parse(cached);
        logger.info(`Returning cached portfolio for wallet ${walletId}`);
        return parsedCache;
      }

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      // Get comprehensive portfolio data from database
      const [portfolio, positions, nfts, transactions, defiPositions, walletData] =
        await Promise.all([
          // Get the main portfolio record
          prisma.cryptoPortfolio.findFirst({
            where: { walletId },
          }),
          // Get positions (assets) with asset details
          prisma.cryptoPosition.findMany({
            where: {
              walletId,
              NOT: { assetId: null },
            },
            include: { asset: true },
            orderBy: { balanceUsd: 'desc' },
          }),
          // Get NFTs with full details
          prisma.cryptoNFT.findMany({
            where: { walletId },
            orderBy: { estimatedValue: 'desc' },
            take: 20, // Limit to top 20 NFTs
          }),
          // Get recent transactions
          prisma.cryptoTransaction.findMany({
            where: { walletId },
            include: { asset: true },
            orderBy: { timestamp: 'desc' },
            take: 10, // Limit to 10 most recent transactions
          }),
          // Get DeFi positions
          prisma.deFiPosition.findMany({
            where: { walletId, isActive: true },
          }),
          prisma.cryptoWallet.findMany({
            where: { id: walletId },
          }),
        ]);

      // Filter positions with valid assets and calculate totals
      const validPositions = positions?.filter((pos) => pos.asset !== null) || [];
      /*    const totalValueUsd = validPositions.reduce((sum, pos) => sum + pos.balanceUsd.toNumber(), 0);
      const totalDeFiValue = defiPositions?.reduce((sum, pos) => sum + pos.totalValueUsd.toNumber(), 0);
      
      const topAssets: AssetBalance[] = validPositions.slice(0, 10).map(pos => ({
        symbol: pos.asset!.symbol,
        name: pos.asset!.name,
        balance: pos.balanceFormatted,
        balanceUsd: pos.balanceUsd?.toNumber(),
        price: pos.asset!.priceUsd?.toNumber() || 0,
        change24h: pos.asset!.change24h?.toNumber() || 0,
        logoUrl: pos.asset!.logoUrl,
        contractAddress: pos.asset!.contractAddress,
        network: pos.asset!.network
      }));

      // Calculate network distribution
      const networkMap = new Map<BlockchainNetwork, number>();
      validPositions.forEach(pos => {
        const current = networkMap.get(pos.asset!.network) || 0;
        networkMap.set(pos.asset!.network, current + pos.balanceUsd.toNumber());
      });

      const networkDistribution = Array.from(networkMap.entries()).map(([network, value]) => ({
        network,
        valueUsd: value,
        percentage: totalValueUsd > 0 ? (value / totalValueUsd) * 100 : 0,
        assetCount: validPositions.filter(p => p.asset!.network === network).length
      }));

      // Calculate asset type distribution
      const typeMap = new Map<AssetType, { value: number, count: number }>();
      validPositions.forEach(pos => {
        const current = typeMap.get(pos.asset!.type) || { value: 0, count: 0 };
        typeMap.set(pos.asset!.type, {
          value: current.value + pos.balanceUsd.toNumber(),
          count: current.count + 1
        });
      });

      const assetTypeDistribution = Array.from(typeMap.entries()).map(([type, data]) => ({
        type,
        valueUsd: data.value,
        percentage: totalValueUsd > 0 ? (data.value / totalValueUsd) * 100 : 0,
        count: data.count
      })); */

      // Serialize BigInt fields in transactions
      const serializedTransactions = transactions.map((tx) => ({
        ...tx,
        blockNumber: tx.blockNumber?.toString() || null,
        gasUsed: tx.gasUsed?.toString() || null,
      }));

      // Build comprehensive portfolio response
      const portfolioResponse = {
        // Main portfolio data from crypto_portfolios table
        portfolio: portfolio
          ? {
              id: portfolio.id,
              totalPositionsValue: portfolio.totalPositionsValue.toNumber(),
              walletValue: portfolio.walletValue.toNumber(),
              depositedValue: portfolio.depositedValue.toNumber(),
              borrowedValue: portfolio.borrowedValue.toNumber(),
              lockedValue: portfolio.lockedValue.toNumber(),
              stakedValue: portfolio.stakedValue.toNumber(),
              // Network-specific values
              arbitrumValue: portfolio.arbitrumValue.toNumber(),
              avalancheValue: portfolio.avalancheValue.toNumber(),
              baseValue: portfolio.baseValue.toNumber(),
              bscValue: portfolio.bscValue.toNumber(),
              celoValue: portfolio.celoValue.toNumber(),
              ethereumValue: portfolio.ethereumValue.toNumber(),
              fantomValue: portfolio.fantomValue.toNumber(),
              lineaValue: portfolio.lineaValue.toNumber(),
              polygonValue: portfolio.polygonValue.toNumber(),
              // Performance data
              absolute24hChange: portfolio.absolute24hChange?.toNumber() || null,
              percent24hChange: portfolio.percent24hChange?.toNumber() || null,
              lastSyncAt: portfolio.lastSyncAt,
              dataFreshness: portfolio.dataFreshness,
              syncSource: portfolio.syncSource,
            }
          : null,

        // Assets (positions) with details
        assets: validPositions.map((pos) => ({
          id: pos.id,
          balance: pos.balanceFormatted,
          balanceUsd: pos.balanceUsd.toNumber(),
          avgCostPrice: pos.avgCostPrice?.toNumber() || null,
          totalCostBasis: pos.totalCostBasis?.toNumber() || null,
          unrealizedPnl: pos.unrealizedPnl?.toNumber() || null,
          unrealizedPnlPct: pos.unrealizedPnlPct?.toNumber() || null,
          dayChange: pos.dayChange?.toNumber() || null,
          dayChangePct: pos.dayChangePct?.toNumber() || null,
          isStaked: pos.isStaked,
          stakingRewards: pos.stakingRewards?.toNumber() || null,
          lastUpdated: pos.lastUpdated,
          asset: {
            id: pos.asset!.id,
            symbol: pos.asset!.symbol,
            name: pos.asset!.name,
            contractAddress: pos.asset!.contractAddress,
            decimals: pos.asset!.decimals,
            type: pos.asset!.type,
            network: pos.asset!.network,
            logoUrl: pos.asset!.logoUrl,
            websiteUrl: pos.asset!.websiteUrl,
            description: pos.asset!.description,
            isVerified: pos.asset!.isVerified,
            price: pos.asset!.price?.toNumber() || null,
            priceUsd: pos.asset!.priceUsd?.toNumber() || null,
            marketCap: pos.asset!.marketCap?.toNumber() || null,
            volume24h: pos.asset!.volume24h?.toNumber() || null,
            change24h: pos.asset!.change24h?.toNumber() || null,
            lastPriceUpdate: pos.asset!.lastPriceUpdate,
          },
        })),

        // NFTs with full details
        nfts: nfts.map((nft) => ({
          id: nft.id,
          contractAddress: nft.contractAddress,
          tokenId: nft.tokenId,
          standard: nft.standard,
          network: nft.network,
          name: nft.name,
          description: nft.description,
          imageUrl: nft.imageUrl,
          animationUrl: nft.animationUrl,
          externalUrl: nft.externalUrl,
          attributes: nft.attributes,
          collectionName: nft.collectionName,
          collectionSymbol: nft.collectionSymbol,
          collectionSlug: nft.collectionSlug,
          ownerAddress: nft.ownerAddress,
          quantity: nft.quantity.toString(),
          transferredAt: nft.transferredAt,
          lastSalePrice: nft.lastSalePrice?.toNumber() || null,
          lastSalePriceUsd: nft.lastSalePriceUsd?.toNumber() || null,
          floorPrice: nft.floorPrice?.toNumber() || null,
          floorPriceUsd: nft.floorPriceUsd?.toNumber() || null,
          estimatedValue: nft.estimatedValue?.toNumber() || null,
          isSpam: nft.isSpam,
          isNsfw: nft.isNsfw,
          rarity: nft.rarity,
          rarityRank: nft.rarityRank,
        })),

        // Recent transactions
        transactions: serializedTransactions,

        // DeFi positions
        defiPositions: defiPositions.map((defi) => ({
          id: defi.id,
          protocolName: defi.protocolName,
          protocolType: defi.protocolType,
          contractAddress: defi.contractAddress,
          network: defi.network,
          positionType: defi.positionType,
          poolName: defi.poolName,
          totalValueUsd: defi.totalValueUsd.toNumber(),
          principalUsd: defi.principalUsd?.toNumber() || null,
          yieldEarned: defi.yieldEarned?.toNumber() || null,
          yieldEarnedUsd: defi.yieldEarnedUsd?.toNumber() || null,
          apr: defi.apr?.toNumber() || null,
          apy: defi.apy?.toNumber() || null,
          dailyYield: defi.dailyYield?.toNumber() || null,
          totalReturn: defi.totalReturn?.toNumber() || null,
          totalReturnPct: defi.totalReturnPct?.toNumber() || null,
          assets: defi.assets,
          isActive: defi.isActive,
          canWithdraw: defi.canWithdraw,
          lockupEnd: defi.lockupEnd,
          positionData: defi.positionData,
          lastYieldClaim: defi.lastYieldClaim,
        })),

        walletData: walletData[0] || null,

        // Summary data
        /*    summary: {
          totalValueUsd: totalValueUsd + totalDeFiValue,
          totalAssets: validPositions.length,
          totalNfts: nfts.length,
          totalDeFiValue,
          dayChange: validPositions.reduce((sum, pos) => sum + (pos.dayChange?.toNumber() || 0), 0),
          dayChangePct: portfolio?.percent24hChange?.toNumber() || 0,
          topAssets,
          networkDistribution,
          assetTypeDistribution
        } */
      };

      // Dynamic cache duration based on wallet age and sync status
      if (this.redis && useCache) {
        try {
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
          const isRecentlyAdded = wallet.createdAt > tenMinutesAgo;

          // Use shorter cache for recently added wallets, longer for established ones
          const cacheDuration = isRecentlyAdded ? 60 : 300; // 1 minute vs 5 minutes

          await this.redis.setex(cacheKey, cacheDuration, JSON.stringify(portfolioResponse));
          logger.info(`Cached portfolio for wallet ${walletId} for ${cacheDuration} seconds`);
        } catch (error) {
          logger.warn('Redis cache write failed:', error);
        }
      }

      return portfolioResponse;
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error fetching wallet portfolio:', error);
      throw new AppError('Failed to fetch wallet portfolio', 500);
    }
  }

  async getAggregatedPortfolio(userId: string): Promise<PortfolioSummary> {
    try {
      const cacheKey = `${CacheKeys.USER_PORTFOLIO}:${userId}`;
      let cached = null;

      if (this.redis) {
        try {
          cached = await this.redis.get(cacheKey);
        } catch (error) {
          logger.warn('Redis cache read failed:', error);
        }
      }

      if (cached) {
        return JSON.parse(cached);
      }

      // Get all user wallets
      const wallets = await prisma.cryptoWallet.findMany({
        where: { userId, isActive: true, isWatching: true },
      });

      if (wallets.length === 0) {
        return {
          totalValueUsd: 0,
          totalAssets: 0,
          totalNfts: 0,
          totalDeFiValue: 0,
          dayChange: 0,
          dayChangePct: 0,
          topAssets: [],
          networkDistribution: [],
          assetTypeDistribution: [],
        };
      }

      // Get aggregated data from all wallets
      const walletIds = wallets.map((w) => w.id);
      const [positions, nfts, defiPositions] = await Promise.all([
        prisma.cryptoPosition.findMany({
          where: { walletId: { in: walletIds } },
          include: { asset: true },
          orderBy: { balanceUsd: 'desc' },
        }),
        prisma.cryptoNFT.count({ where: { walletId: { in: walletIds } } }),
        prisma.deFiPosition.findMany({
          where: { walletId: { in: walletIds }, isActive: true },
        }),
      ]);

      // Filter positions with valid assets
      const validPositions = positions.filter((pos) => pos.asset !== null);

      // Aggregate positions by asset
      const assetMap = new Map<string, AssetBalance>();
      validPositions.forEach((pos) => {
        const key = `${pos.asset!.symbol}_${pos.asset!.network}_${pos.asset!.contractAddress || 'native'}`;
        const existing = assetMap.get(key);

        if (existing) {
          existing.balanceUsd += pos.balanceUsd.toNumber();
          existing.balance = (
            parseFloat(existing.balance) + parseFloat(pos.balanceFormatted)
          ).toString();
        } else {
          assetMap.set(key, {
            symbol: pos.asset!.symbol,
            name: pos.asset!.name,
            balance: pos.balanceFormatted,
            balanceUsd: pos.balanceUsd.toNumber(),
            price: pos.asset!.priceUsd?.toNumber() || 0,
            change24h: pos.asset!.change24h?.toNumber() || 0,
            logoUrl: pos.asset!.logoUrl,
            contractAddress: pos.asset!.contractAddress,
            network: pos.asset!.network,
          });
        }
      });

      const totalValueUsd = Array.from(assetMap.values()).reduce(
        (sum, asset) => sum + asset.balanceUsd,
        0
      );
      const totalDeFiValue = defiPositions.reduce(
        (sum, pos) => sum + pos.totalValueUsd.toNumber(),
        0
      );
      const topAssets = Array.from(assetMap.values())
        .sort((a, b) => b.balanceUsd - a.balanceUsd)
        .slice(0, 10);

      // Calculate network distribution
      const networkMap = new Map<BlockchainNetwork, number>();
      Array.from(assetMap.values()).forEach((asset) => {
        const current = networkMap.get(asset.network) || 0;
        networkMap.set(asset.network, current + asset.balanceUsd);
      });

      const networkDistribution = Array.from(networkMap.entries()).map(([network, value]) => ({
        network,
        valueUsd: value,
        percentage: totalValueUsd > 0 ? (value / totalValueUsd) * 100 : 0,
        assetCount: Array.from(assetMap.values()).filter((a) => a.network === network).length,
      }));

      // Calculate asset type distribution
      const typeMap = new Map<AssetType, { value: number; count: number }>();
      validPositions.forEach((pos) => {
        const current = typeMap.get(pos.asset!.type) || { value: 0, count: 0 };
        typeMap.set(pos.asset!.type, {
          value: current.value + pos.balanceUsd.toNumber(),
          count: current.count + 1,
        });
      });

      const assetTypeDistribution = Array.from(typeMap.entries()).map(([type, data]) => ({
        type,
        valueUsd: data.value,
        percentage: totalValueUsd > 0 ? (data.value / totalValueUsd) * 100 : 0,
        count: data.count,
      }));

      const portfolio: PortfolioSummary = {
        totalValueUsd: totalValueUsd + totalDeFiValue,
        totalAssets: assetMap.size,
        totalNfts: nfts,
        totalDeFiValue,
        dayChange: Array.from(assetMap.values()).reduce(
          (sum, asset) => sum + (asset.change24h * asset.balanceUsd) / asset.price,
          0
        ),
        dayChangePct: 0, // Calculate based on previous day data
        topAssets,
        networkDistribution,
        assetTypeDistribution,
      };

      // Cache for 3 minutes (if Redis available)
      if (this.redis) {
        try {
          await this.redis.setex(cacheKey, 180, JSON.stringify(portfolio));
        } catch (error) {
          logger.warn('Redis cache write failed:', error);
        }
      }

      return portfolio;
    } catch (error) {
      logger.error('Error fetching aggregated portfolio:', error);
      throw new AppError('Failed to fetch aggregated portfolio', 500);
    }
  }

  // ===============================
  // TRANSACTION HISTORY
  // ===============================

  async getWalletTransactions(
    userId: string,
    walletId: string,
    filters: CryptoTransactionFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<PaginatedResponse<any>> {
    try {
      // Check wallet ownership
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      // Build filter conditions
      const where: any = { walletId };

      if (filters.type?.length) where.type = { in: filters.type };
      if (filters.status?.length) where.status = { in: filters.status };
      if (filters.network?.length) where.network = { in: filters.network };
      if (filters.startDate) where.timestamp = { gte: filters.startDate };
      if (filters.endDate) where.timestamp = { ...where.timestamp, lte: filters.endDate };
      if (filters.minValue) where.valueUsd = { gte: filters.minValue };
      if (filters.maxValue) where.valueUsd = { ...where.valueUsd, lte: filters.maxValue };
      if (filters.search) {
        where.OR = [
          { hash: { contains: filters.search, mode: 'insensitive' } },
          { fromAddress: { contains: filters.search, mode: 'insensitive' } },
          { toAddress: { contains: filters.search, mode: 'insensitive' } },
          { assetSymbol: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      // Get total count
      const total = await prisma.cryptoTransaction.count({ where });

      // Get transactions
      const transactions = await prisma.cryptoTransaction.findMany({
        where,
        include: {
          asset: true,
        },
        orderBy: { timestamp: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      });

      const pages = Math.ceil(total / pagination.limit);

      // Serialize BigInt fields for JSON response
      const serializedTransactions = transactions.map((tx) => ({
        ...tx,
        blockNumber: tx.blockNumber?.toString() || null,
        gasUsed: tx.gasUsed?.toString() || null,
      }));

      return {
        data: serializedTransactions,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages,
          hasNext: pagination.page < pages,
          hasPrev: pagination.page > 1,
        },
      };
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error fetching wallet transactions:', error);
      throw new AppError('Failed to fetch wallet transactions', 500);
    }
  }

  // ===============================
  // NFT MANAGEMENT
  // ===============================

  async getWalletNFTs(
    userId: string,
    walletId: string,
    filters: NFTFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<PaginatedResponse<any>> {
    try {
      // Check wallet ownership
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      // Build filter conditions
      const where: any = { walletId };

      if (filters.collections?.length) where.collectionSlug = { in: filters.collections };
      if (filters.network?.length) where.network = { in: filters.network };
      if (filters.standard?.length) where.standard = { in: filters.standard };
      if (filters.hasPrice !== undefined) {
        where.floorPriceUsd = filters.hasPrice ? { gt: 0 } : null;
      }
      if (filters.isSpam !== undefined) where.isSpam = filters.isSpam;
      if (filters.search) {
        where.OR = [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { collectionName: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      // Get total count
      const total = await prisma.cryptoNFT.count({ where });

      // Get NFTs
      const nfts = await prisma.cryptoNFT.findMany({
        where,
        orderBy: [{ estimatedValue: 'desc' }, { createdAt: 'desc' }],
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      });

      const pages = Math.ceil(total / pagination.limit);

      // Transform BigInt fields to strings for JSON serialization
      const serializedNfts = nfts.map((nft) => this.serializeNFT(nft));

      return {
        data: serializedNfts,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages,
          hasNext: pagination.page < pages,
          hasPrev: pagination.page > 1,
        },
      };
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error fetching wallet NFTs:', error);
      throw new AppError('Failed to fetch wallet NFTs', 500);
    }
  }

  // ===============================
  // DeFi POSITIONS
  // ===============================

  async getWalletDeFiPositions(
    userId: string,
    walletId: string,
    filters: DeFiPositionFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<PaginatedResponse<any>> {
    try {
      // Check wallet ownership
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      // Build filter conditions
      const where: any = { walletId };

      if (filters.protocols?.length) where.protocolName = { in: filters.protocols };
      if (filters.types?.length) where.positionType = { in: filters.types };
      if (filters.networks?.length) where.network = { in: filters.networks };
      if (filters.minValue) where.totalValueUsd = { gte: filters.minValue };
      if (filters.isActive !== undefined) where.isActive = filters.isActive;

      // Get total count
      const total = await prisma.deFiPosition.count({ where });

      // Get positions
      const positions = await prisma.deFiPosition.findMany({
        where,
        orderBy: { totalValueUsd: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      });

      const pages = Math.ceil(total / pagination.limit);

      return {
        data: positions,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages,
          hasNext: pagination.page < pages,
          hasPrev: pagination.page > 1,
        },
      };
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error fetching wallet DeFi positions:', error);
      throw new AppError('Failed to fetch wallet DeFi positions', 500);
    }
  }

  // ===============================
  // SYNC AND UPDATE METHODS
  // ===============================

  private async scheduleWalletSync(userId: string, walletId: string, fullSync: boolean = false) {
    try {
      if (!cryptoSyncQueue) {
        logger.warn(
          `Sync scheduled but queue not available for wallet ${walletId} - sync will be skipped`
        );
        return 'queue_not_available';
      }

      const jobType = fullSync ? JOB_TYPES.SYNC_WALLET_FULL : JOB_TYPES.SYNC_WALLET;
      const jobData = { userId, walletId, fullSync };

      const job = await cryptoSyncQueue.add(jobType, jobData, {
        priority: fullSync ? 5 : 10, // Full sync has higher priority
        delay: 1000, // Small delay to ensure wallet is saved
        removeOnComplete: 10,
        removeOnFail: 5,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });

      logger.info(`Scheduled wallet sync job ${job.id} for wallet ${walletId}`, {
        jobType,
        fullSync,
        jobId: job.id,
      });

      return job.id;
    } catch (error) {
      logger.error(`Failed to schedule wallet sync for ${walletId}:`, error);
      throw error;
    }
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  private serializeNFT(nft: any) {
    return this.serializeBigIntFields(nft);
  }

  private serializeBigIntFields(obj: any): any {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'bigint') {
      return obj.toString();
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.serializeBigIntFields(item));
    }

    if (typeof obj === 'object') {
      const serialized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        serialized[key] = this.serializeBigIntFields(value);
      }
      return serialized;
    }

    return obj;
  }

  // ===============================
  // ENHANCED SYNC METHODS
  // ===============================

  async manualSync(
    userId: string,
    walletId: string,
    options: {
      syncAssets?: boolean;
      syncTransactions?: boolean;
      syncNFTs?: boolean;
      syncDeFi?: boolean;
      syncTypes?: string[]; // Support array format
    } = {}
  ) {
    try {
      // Verify wallet ownership
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      if (!cryptoSyncQueue) {
        logger.warn(`Manual sync requested for wallet ${walletId} but queue not available`);
        return {
          success: false,
          jobId: null,
          status: 'queue_unavailable',
          message: 'Background job queue not available - sync will be performed synchronously',
          wallet: {
            id: wallet.id,
            address: wallet.address,
            name: wallet.name,
            network: wallet.network,
          },
        };
      }

      // Update wallet sync status
      await prisma.cryptoWallet.update({
        where: { id: walletId },
        data: { syncStatus: 'IN_PROGRESS' },
      });

      // Schedule full sync job
      const jobData = {
        userId,
        walletId,
        syncAssets: options.syncAssets ?? true,
        syncTransactions: options.syncTransactions ?? true,
        syncNFTs: options.syncNFTs ?? false,
        syncDeFi: options.syncDeFi ?? false,
        syncTypes: options.syncTypes, // Pass syncTypes array
      };

      const job = await cryptoSyncQueue.add(JOB_TYPES.SYNC_WALLET_FULL, jobData, {
        priority: 1, // Highest priority for manual sync
        removeOnComplete: 5,
        removeOnFail: 3,
        attempts: 2,
      });

      logger.info(`Manual sync initiated for wallet ${walletId}`, {
        userId,
        jobId: job.id,
        options,
      });

      // Clear cache to ensure fresh data after sync
      await this.clearWalletCache(walletId);
      await this.clearUserCache(userId);

      return {
        success: true,
        jobId: job.id,
        status: 'initiated',
        wallet: {
          id: wallet.id,
          address: wallet.address,
          name: wallet.name,
          network: wallet.network,
        },
      };
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error initiating manual sync:', error);
      throw new AppError('Failed to initiate manual sync', 500);
    }
  }

  async scheduleTransactionSync(userId: string, walletId: string, cursor?: string) {
    try {
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      if (!cryptoSyncQueue) {
        logger.warn(`Transaction sync requested for wallet ${walletId} but queue not available`);
        return { jobId: null, status: 'queue_unavailable' };
      }

      const jobData = { userId, walletId, cursor };

      const job = await cryptoSyncQueue.add(JOB_TYPES.SYNC_TRANSACTIONS, jobData, {
        priority: 8,
        removeOnComplete: 20,
        removeOnFail: 5,
        attempts: 3,
      });

      logger.info(`Transaction sync scheduled for wallet ${walletId}`, {
        userId,
        jobId: job.id,
        cursor,
      });

      return { jobId: job.id, status: 'scheduled' };
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error scheduling transaction sync:', error);
      throw new AppError('Failed to schedule transaction sync', 500);
    }
  }

  async schedulePortfolioCalculation(
    userId: string,
    walletId?: string,
    includeAnalytics: boolean = false
  ) {
    try {
      if (!cryptoAnalyticsQueue) {
        logger.warn(`Portfolio calculation requested for user ${userId} but queue not available`);
        return { jobId: null, status: 'queue_unavailable' };
      }

      const jobData = { userId, walletId, includeAnalytics };

      const job = await cryptoAnalyticsQueue.add(JOB_TYPES.CALCULATE_PORTFOLIO, jobData, {
        priority: 5,
        removeOnComplete: 10,
        removeOnFail: 3,
        attempts: 2,
      });

      logger.info(`Portfolio calculation scheduled for user ${userId}`, {
        jobId: job.id,
        walletId,
        includeAnalytics,
      });

      return { jobId: job.id, status: 'scheduled' };
    } catch (error) {
      logger.error('Error scheduling portfolio calculation:', error);
      throw new AppError('Failed to schedule portfolio calculation', 500);
    }
  }

  async getZerionWalletData(
    address: string,
    dataType: 'portfolio' | 'summary' | 'transactions' | 'positions' | 'pnl'
  ) {
    if (!this.zerionService) {
      throw new CryptoServiceError(
        'Zerion service not available',
        CryptoErrorCodes.ZERION_API_ERROR,
        503
      );
    }

    try {
      logger.debug(`Fetching ${dataType} data from Zerion for address: ${address}`);

      switch (dataType) {
        case 'portfolio':
          return await this.zerionService.getWalletPortfolio(address);
        case 'summary':
          return await this.zerionService.getWalletSummary(address);
        case 'transactions':
          return await this.zerionService.getWalletTransactions(address);
        case 'positions':
          return await this.zerionService.getWalletPositions(address);
        case 'pnl':
          return await this.zerionService.getWalletPnL(address);
        default:
          throw new CryptoServiceError(
            `Unsupported data type: ${dataType}`,
            CryptoErrorCodes.ZERION_API_ERROR,
            400
          );
      }
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error(`Error fetching ${dataType} from Zerion:`, error);
      throw new AppError(`Failed to fetch ${dataType} data`, 500);
    }
  }

  // ===============================
  // ZAPPER INTEGRATION METHODS
  // ===============================

  async getZapperWalletData(
    userId: string,
    walletId: string,
    options: ZapperSyncOptions = {}
  ): Promise<ZapperWalletData> {
    if (!this.zapperService) {
      throw new CryptoServiceError(
        'Zapper service not available',
        CryptoErrorCodes.ZAPPER_API_ERROR,
        503
      );
    }

    try {
      // Verify wallet ownership
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet) {
        throw new CryptoServiceError('Wallet not found', CryptoErrorCodes.WALLET_NOT_FOUND, 404);
      }

      const cacheKey = `zapper:wallet:${walletId}`;
      let cached = null;

      if (this.redis) {
        try {
          cached = await this.redis.get(cacheKey);
        } catch (error) {
          logger.warn('Redis cache read failed:', error);
        }
      }

      if (cached) {
        return JSON.parse(cached);
      }

      logger.info(`Fetching Zapper data for wallet: ${wallet.address}`);

      // Determine chain IDs to query based on options
      const chainIds = options.networks?.map((network) =>
        this.zapperService!.networkToChainId(network)
      );

      // Fetch data from individual Zapper methods in parallel
      const [assetsResponse, nftsResponse, transactionsResponse] = await Promise.all([
        // Always fetch assets
        this.zapperService.getWalletAssets([wallet.address], chainIds),

        // Fetch NFTs if requested (default true)
        options.includeNFTs !== false
          ? this.zapperService.getWalletNFTs([wallet.address], chainIds)
          : Promise.resolve(null),

        // Fetch transactions if requested
        options.includeTransactions
          ? this.zapperService.getWalletTransactions(
              [wallet.address],
              options.maxTransactions || 20
            )
          : Promise.resolve(null),
      ]);
      // Process Zapper data into our format using individual responses
      const zapperData = this.processZapperIndividualData(
        wallet.address,
        {
          assets: assetsResponse,
          nfts: nftsResponse,
          transactions: transactionsResponse,
        },
        options
      );

      // Cache for 5 minutes (if Redis available)
      if (this.redis) {
        try {
          await this.redis.setex(cacheKey, 300, JSON.stringify(zapperData));
        } catch (error) {
          logger.warn('Redis cache write failed:', error);
        }
      }

      return zapperData;
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error fetching Zapper wallet data:', error);
      throw new AppError('Failed to fetch Zapper wallet data', 500);
    }
  }

  async getZapperFarcasterData(
    fids?: number[],
    usernames?: string[],
    options: ZapperSyncOptions = {}
  ) {
    if (!this.zapperService) {
      throw new CryptoServiceError(
        'Zapper service not available',
        CryptoErrorCodes.ZAPPER_API_ERROR,
        503
      );
    }

    try {
      logger.info('Fetching Farcaster portfolio data via Zapper', { fids, usernames });

      const result = await this.zapperService.getFarcasterPortfolio(fids, usernames);

      if (!result.portfolio || result.addresses.length === 0) {
        return {
          addresses: result.addresses,
          portfolioData: null,
        };
      }

      const portfolioData = this.processZapperPortfolioData(
        result.addresses.join(','),
        result.portfolio,
        options
      );

      return {
        addresses: result.addresses,
        portfolioData,
      };
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error fetching Farcaster data from Zapper:', error);
      throw new AppError('Failed to fetch Farcaster data', 500);
    }
  }

  private processZapperPortfolioData(
    address: string,
    portfolioResponse: any,
    options: ZapperSyncOptions
  ): ZapperWalletData {
    const portfolio = portfolioResponse.portfolioV2;

    const portfolioSummary = {
      totalValueUsd:
        portfolio.tokenBalances.totalBalanceUSD +
        portfolio.appBalances.totalBalanceUSD +
        portfolio.nftBalances.totalBalanceUSD,
      tokenValue: portfolio.tokenBalances.totalBalanceUSD,
      appPositionValue: portfolio.appBalances.totalBalanceUSD,
      nftValue: portfolio.nftBalances.totalBalanceUSD,
      tokenCount: portfolio.tokenBalances.byToken.edges.length,
      appPositionCount: portfolio.appBalances.byApp.edges.length,
      nftCount: parseInt(portfolio.nftBalances.totalTokensOwned || '0'),
    };

    // Process NFTs
    const nfts =
      options.includeNFTs !== false
        ? portfolio.nftBalances.byCollection.edges.flatMap((edge: any) =>
            edge.node.collection.nfts.edges.map((nftEdge: any) => ({
              tokenId: nftEdge.node.id,
              name: nftEdge.node.name || 'Unnamed NFT',
              imageUrl: nftEdge.node.mediasV3?.images.edges[0]?.node.url || null,
              estimatedValueUsd: nftEdge.node.estimatedValue?.valueUsd || 0,
              collectionName: edge.node.collection.displayName || edge.node.collection.name,
              collectionAddress: edge.node.collection.address,
              floorPrice: edge.node.collection.floorPrice?.valueUsd || null,
              spamScore: edge.node.collection.spamScore || 0,
            }))
          )
        : [];

    return {
      address,
      portfolioSummary,
      nfts,
      lastUpdated: new Date(),
    };
  }

  private processZapperIndividualData(
    address: string,
    responses: {
      assets: any;
      nfts: any | null;
      transactions: any | null;
    },
    options: ZapperSyncOptions
  ): ZapperWalletData {
    const { assets, nfts } = responses;

    // Calculate portfolio summary from individual responses
    const tokenValue = assets?.portfolioV2?.tokenBalances?.totalBalanceUSD || 0;
    const nftValue = nfts?.portfolioV2?.nftBalances?.totalBalanceUSD || 0;

    const portfolioSummary = {
      totalValueUsd: tokenValue + nftValue,
      tokenValue: tokenValue,
      appPositionValue: 0, // Not available in individual calls
      nftValue: nftValue,
      tokenCount: assets?.portfolioV2?.tokenBalances?.byToken?.edges?.length || 0,
      appPositionCount: 0, // Not available in individual calls
      nftCount: parseInt(nfts?.portfolioV2?.nftBalances?.totalTokensOwned || '0'),
    };

    // Process NFTs from NFTs response
    const processedNfts =
      options.includeNFTs !== false && nfts?.portfolioV2?.nftBalances?.byToken?.edges
        ? nfts.portfolioV2.nftBalances.byToken.edges
            .filter((edge: any) => (edge?.node?.token?.collection?.spamScore || 0) < 75)
            .map((edge: any) => ({
              tokenId: edge?.node?.token?.tokenId,
              name: edge?.node?.token?.name || 'Unnamed NFT',
              imageUrl:
                edge.node.token.mediasV3?.images.edges[0]?.node?.medium ||
                edge.node.token.mediasV3?.images.edges[0]?.node?.large ||
                null,
              estimatedValueUsd: edge.node.token.estimatedValue?.valueUsd || 0,
              valueNative: edge.node.token.estimatedValue?.valueWithDenomination || 0,
              valueNativeSymbol: edge.node.token.estimatedValue?.denomination?.symbol || null,
              collectionName: edge.node.token.collection?.name || edge.node.collection?.displayName,
              collection_imageUrl:
                edge?.node?.token?.collection?.medias?.medium ||
                edge.node.collection?.medias?.large ||
                null,
              spamScore: edge?.node?.token?.collection?.spamScore || 0,
              collectionAddress: edge?.node?.token?.collection?.address,
            }))
        : [];

    // Process transactions if available

    return {
      address,
      portfolioSummary,

      // Not available in individual asset/NFT calls
      nfts: processedNfts,

      lastUpdated: new Date(),
    };
  }

  async getJobStatus(jobId: string) {
    try {
      if (!cryptoSyncQueue && !cryptoAnalyticsQueue) {
        return {
          status: 'queue_unavailable',
          message: 'Job queues not available',
        };
      }

      let job = null;

      // Try to find job in sync queue first
      if (cryptoSyncQueue) {
        job = await cryptoSyncQueue.getJob(jobId);
      }

      if (!job && cryptoAnalyticsQueue) {
        // Try analytics queue
        job = await cryptoAnalyticsQueue.getJob(jobId);
      }

      if (!job) {
        return {
          status: 'not_found',
          message: 'Job not found',
        };
      }

      const state = await job.getState();
      const progress = typeof job.progress === 'function' ? job.progress() : 0;

      return {
        id: job.id,
        name: job.name,
        status: state,
        progress,
        data: job.data,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        createdAt: new Date(job.timestamp),
        processedAt: job.processedOn ? new Date(job.processedOn) : null,
        finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
        result: job.returnvalue,
        error: job.failedReason,
      };
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}:`, error);
      throw new AppError('Failed to get job status', 500);
    }
  }

  // ===============================
  // CACHE MANAGEMENT
  // ===============================

  async clearWalletCache(walletId: string) {
    if (!this.redis) return;

    const keys = [
      `${CacheKeys.WALLET_PORTFOLIO}:${walletId}`,
      `${CacheKeys.WALLET_TRANSACTIONS}:${walletId}`,
      `${CacheKeys.WALLET_NFTS}:${walletId}`,
      `${CacheKeys.WALLET_DEFI}:${walletId}`,
    ];

    try {
      await Promise.all(keys.map((key) => this.redis!.del(key)));
    } catch (error) {
      logger.warn('Failed to clear wallet cache:', error);
    }
  }

  async clearUserCache(userId: string) {
    if (!this.redis) return;

    const keys = [`${CacheKeys.USER_PORTFOLIO}:${userId}`];

    // Get user wallets to clear wallet-specific cache
    const wallets = await prisma.cryptoWallet.findMany({
      where: { userId },
      select: { id: true },
    });

    for (const wallet of wallets) {
      await this.clearWalletCache(wallet.id);
    }

    try {
      await Promise.all(keys.map((key) => this.redis!.del(key)));
    } catch (error) {
      logger.warn('Failed to clear user cache:', error);
    }
  }

  // ===============================
  // HEALTH AND MONITORING
  // ===============================

  async getServiceHealth() {
    const health = {
      redis: false,
      zerion: false,
      zapper: false,
      database: false,
      queues: {
        syncQueue: false,
        analyticsQueue: false,
      },
    };

    try {
      // Test Redis
      if (this.redis) {
        await this.redis.ping();
        health.redis = true;
      }
    } catch (error) {
      logger.error('Redis health check failed:', error);
    }

    try {
      // Test Zerion service
      if (this.zerionService) {
        const zerionHealth = await this.zerionService.healthCheck();
        health.zerion = zerionHealth.healthy;
      }
    } catch (error) {
      logger.error('Zerion health check failed:', error);
    }

    try {
      // Test Zapper service
      if (this.zapperService) {
        const zapperHealth = await this.zapperService.healthCheck();
        health.zapper = zapperHealth.healthy;
      }
    } catch (error) {
      logger.error('Zapper health check failed:', error);
    }

    try {
      // Test Database
      await prisma.$queryRaw`SELECT 1`;
      health.database = true;
    } catch (error) {
      logger.error('Database health check failed:', error);
    }

    try {
      // Test Queues
      if (cryptoSyncQueue) {
        await cryptoSyncQueue.getWaiting();
        health.queues.syncQueue = true;
      }
    } catch (error) {
      logger.error('Sync queue health check failed:', error);
    }

    try {
      if (cryptoAnalyticsQueue) {
        await cryptoAnalyticsQueue.getWaiting();
        health.queues.analyticsQueue = true;
      }
    } catch (error) {
      logger.error('Analytics queue health check failed:', error);
    }

    return health;
  }

  private isValidAddress(address: string, network: BlockchainNetwork): boolean {
    // Basic validation - in production, use proper address validation libraries
    switch (network) {
      case BlockchainNetwork.ETHEREUM:
      case BlockchainNetwork.POLYGON:
      case BlockchainNetwork.BSC:
      case BlockchainNetwork.ARBITRUM:
      case BlockchainNetwork.OPTIMISM:
      case BlockchainNetwork.AVALANCHE:
      case BlockchainNetwork.BASE:
        return /^0x[a-fA-F0-9]{40}$/.test(address);
      case BlockchainNetwork.SOLANA:
        return address.length >= 32 && address.length <= 44;
      case BlockchainNetwork.BITCOIN:
        return (
          /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || /^bc1[a-z0-9]{39,59}$/.test(address)
        );
      default:
        return true; // Allow unknown networks for now
    }
  }
}

export const cryptoService = new CryptoService();
