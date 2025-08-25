import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { BlockchainNetwork, AssetType } from '@prisma/client';
import Redis from 'ioredis';
// import ZerionSDK from 'zerion-sdk-ts';
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
  CacheKeys
} from '@/types/crypto';

export class CryptoService {
  // private zerionSDK: ZerionSDK;
  private redis: Redis;

  constructor() {
    // Initialize Zerion SDK
    const zerionApiKey = process.env['ZERION_API_KEY'];
    if (!zerionApiKey) {
      logger.warn('ZERION_API_KEY environment variable not set. Crypto features will be limited.');
    }
    
    if (zerionApiKey) {
      try {
        // this.zerionSDK = new ZerionSDK(zerionApiKey);
        logger.info('Zerion API key found, but SDK initialization is disabled for now');
      } catch (error) {
        logger.error('Failed to initialize Zerion SDK:', error);
        throw new Error('Failed to initialize Zerion SDK');
      }
    }
    
    // Initialize Redis for caching
    try {
      this.redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379');
      logger.info('Redis client initialized for crypto service');
    } catch (error) {
      logger.error('Failed to initialize Redis:', error);
      throw new Error('Failed to initialize Redis client');
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
            network: walletData.network
          }
        }
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
          tags: walletData.tags || []
        },
        include: {
          user: true
        }
      });

      // Initialize wallet sync in background
      await this.scheduleWalletSync(userId, wallet.id, true);

      logger.info(`Crypto wallet added for user ${userId}: ${walletData.address} on ${walletData.network}`);
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
          userId
        }
      });

      if (!wallet) {
        throw new CryptoServiceError(
          'Wallet not found',
          CryptoErrorCodes.WALLET_NOT_FOUND,
          404
        );
      }

      // Delete wallet and all related data
      await prisma.cryptoWallet.delete({
        where: { id: walletId }
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
          userId
        }
      });

      if (!wallet) {
        throw new CryptoServiceError(
          'Wallet not found',
          CryptoErrorCodes.WALLET_NOT_FOUND,
          404
        );
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
        data: cleanedUpdateData
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
          isActive: true 
        },
        include: {
          assets: {
            take: 5
          },
          _count: {
            select: {
              assets: true,
              nfts: true,
              transactions: true
            }
          }
        },
        orderBy: [
          { totalBalanceUsd: 'desc' },
          { createdAt: 'desc' }
        ]
      });

      return wallets;
    } catch (error) {
      logger.error('Error fetching user wallets:', error);
      throw new AppError('Failed to fetch crypto wallets', 500);
    }
  }

  // ===============================
  // PORTFOLIO DATA
  // ===============================

  async getWalletPortfolio(userId: string, walletId: string): Promise<PortfolioSummary> {
    try {
      const cacheKey = `${CacheKeys.WALLET_PORTFOLIO}:${walletId}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Check if wallet belongs to user
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId }
      });

      if (!wallet) {
        throw new CryptoServiceError(
          'Wallet not found',
          CryptoErrorCodes.WALLET_NOT_FOUND,
          404
        );
      }

      // Get portfolio data from database
      const [positions, nfts, defiPositions] = await Promise.all([
        prisma.cryptoPosition.findMany({
          where: { walletId },
          include: { asset: true },
          orderBy: { balanceUsd: 'desc' }
        }),
        prisma.cryptoNFT.count({ where: { walletId } }),
        prisma.deFiPosition.findMany({
          where: { walletId, isActive: true }
        })
      ]);

      // Calculate totals and summaries
      const totalValueUsd = positions.reduce((sum, pos) => sum + pos.balanceUsd.toNumber(), 0);
      const totalDeFiValue = defiPositions.reduce((sum, pos) => sum + pos.totalValueUsd.toNumber(), 0);
      
      const topAssets: AssetBalance[] = positions.slice(0, 10).map(pos => ({
        symbol: pos.asset.symbol,
        name: pos.asset.name,
        balance: pos.balanceFormatted,
        balanceUsd: pos.balanceUsd.toNumber(),
        price: pos.asset.priceUsd?.toNumber() || 0,
        change24h: pos.asset.change24h?.toNumber() || 0,
        logoUrl: pos.asset.logoUrl,
        contractAddress: pos.asset.contractAddress,
        network: pos.asset.network
      }));

      // Calculate network distribution
      const networkMap = new Map<BlockchainNetwork, number>();
      positions.forEach(pos => {
        const current = networkMap.get(pos.asset.network) || 0;
        networkMap.set(pos.asset.network, current + pos.balanceUsd.toNumber());
      });

      const networkDistribution = Array.from(networkMap.entries()).map(([network, value]) => ({
        network,
        valueUsd: value,
        percentage: totalValueUsd > 0 ? (value / totalValueUsd) * 100 : 0,
        assetCount: positions.filter(p => p.asset.network === network).length
      }));

      // Calculate asset type distribution
      const typeMap = new Map<AssetType, { value: number, count: number }>();
      positions.forEach(pos => {
        const current = typeMap.get(pos.asset.type) || { value: 0, count: 0 };
        typeMap.set(pos.asset.type, {
          value: current.value + pos.balanceUsd.toNumber(),
          count: current.count + 1
        });
      });

      const assetTypeDistribution = Array.from(typeMap.entries()).map(([type, data]) => ({
        type,
        valueUsd: data.value,
        percentage: totalValueUsd > 0 ? (data.value / totalValueUsd) * 100 : 0,
        count: data.count
      }));

      const portfolio: PortfolioSummary = {
        totalValueUsd: totalValueUsd + totalDeFiValue,
        totalAssets: positions.length,
        totalNfts: nfts,
        totalDeFiValue,
        dayChange: positions.reduce((sum, pos) => sum + (pos.dayChange?.toNumber() || 0), 0),
        dayChangePct: 0, // Calculate based on previous day data
        topAssets,
        networkDistribution,
        assetTypeDistribution
      };

      // Cache for 5 minutes
      await this.redis.setex(cacheKey, 300, JSON.stringify(portfolio));

      return portfolio;
    } catch (error) {
      if (error instanceof CryptoServiceError) throw error;
      logger.error('Error fetching wallet portfolio:', error);
      throw new AppError('Failed to fetch wallet portfolio', 500);
    }
  }

  async getAggregatedPortfolio(userId: string): Promise<PortfolioSummary> {
    try {
      const cacheKey = `${CacheKeys.USER_PORTFOLIO}:${userId}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Get all user wallets
      const wallets = await prisma.cryptoWallet.findMany({
        where: { userId, isActive: true, isWatching: true }
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
          assetTypeDistribution: []
        };
      }

      // Get aggregated data from all wallets
      const walletIds = wallets.map(w => w.id);
      const [positions, nfts, defiPositions] = await Promise.all([
        prisma.cryptoPosition.findMany({
          where: { walletId: { in: walletIds } },
          include: { asset: true },
          orderBy: { balanceUsd: 'desc' }
        }),
        prisma.cryptoNFT.count({ where: { walletId: { in: walletIds } } }),
        prisma.deFiPosition.findMany({
          where: { walletId: { in: walletIds }, isActive: true }
        })
      ]);

      // Aggregate positions by asset
      const assetMap = new Map<string, AssetBalance>();
      positions.forEach(pos => {
        const key = `${pos.asset.symbol}_${pos.asset.network}_${pos.asset.contractAddress || 'native'}`;
        const existing = assetMap.get(key);
        
        if (existing) {
          existing.balanceUsd += pos.balanceUsd.toNumber();
          existing.balance = (parseFloat(existing.balance) + parseFloat(pos.balanceFormatted)).toString();
        } else {
          assetMap.set(key, {
            symbol: pos.asset.symbol,
            name: pos.asset.name,
            balance: pos.balanceFormatted,
            balanceUsd: pos.balanceUsd.toNumber(),
            price: pos.asset.priceUsd?.toNumber() || 0,
            change24h: pos.asset.change24h?.toNumber() || 0,
            logoUrl: pos.asset.logoUrl,
            contractAddress: pos.asset.contractAddress,
            network: pos.asset.network
          });
        }
      });

      const totalValueUsd = Array.from(assetMap.values()).reduce((sum, asset) => sum + asset.balanceUsd, 0);
      const totalDeFiValue = defiPositions.reduce((sum, pos) => sum + pos.totalValueUsd.toNumber(), 0);
      const topAssets = Array.from(assetMap.values()).sort((a, b) => b.balanceUsd - a.balanceUsd).slice(0, 10);

      // Calculate network distribution
      const networkMap = new Map<BlockchainNetwork, number>();
      Array.from(assetMap.values()).forEach(asset => {
        const current = networkMap.get(asset.network) || 0;
        networkMap.set(asset.network, current + asset.balanceUsd);
      });

      const networkDistribution = Array.from(networkMap.entries()).map(([network, value]) => ({
        network,
        valueUsd: value,
        percentage: totalValueUsd > 0 ? (value / totalValueUsd) * 100 : 0,
        assetCount: Array.from(assetMap.values()).filter(a => a.network === network).length
      }));

      // Calculate asset type distribution
      const typeMap = new Map<AssetType, { value: number, count: number }>();
      positions.forEach(pos => {
        const current = typeMap.get(pos.asset.type) || { value: 0, count: 0 };
        typeMap.set(pos.asset.type, {
          value: current.value + pos.balanceUsd.toNumber(),
          count: current.count + 1
        });
      });

      const assetTypeDistribution = Array.from(typeMap.entries()).map(([type, data]) => ({
        type,
        valueUsd: data.value,
        percentage: totalValueUsd > 0 ? (data.value / totalValueUsd) * 100 : 0,
        count: data.count
      }));

      const portfolio: PortfolioSummary = {
        totalValueUsd: totalValueUsd + totalDeFiValue,
        totalAssets: assetMap.size,
        totalNfts: nfts,
        totalDeFiValue,
        dayChange: Array.from(assetMap.values()).reduce((sum, asset) => sum + (asset.change24h * asset.balanceUsd / asset.price), 0),
        dayChangePct: 0, // Calculate based on previous day data
        topAssets,
        networkDistribution,
        assetTypeDistribution
      };

      // Cache for 3 minutes
      await this.redis.setex(cacheKey, 180, JSON.stringify(portfolio));

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
        where: { id: walletId, userId }
      });

      if (!wallet) {
        throw new CryptoServiceError(
          'Wallet not found',
          CryptoErrorCodes.WALLET_NOT_FOUND,
          404
        );
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
          { assetSymbol: { contains: filters.search, mode: 'insensitive' } }
        ];
      }

      // Get total count
      const total = await prisma.cryptoTransaction.count({ where });

      // Get transactions
      const transactions = await prisma.cryptoTransaction.findMany({
        where,
        include: {
          asset: true
        },
        orderBy: { timestamp: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit
      });

      const pages = Math.ceil(total / pagination.limit);

      return {
        data: transactions,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages,
          hasNext: pagination.page < pages,
          hasPrev: pagination.page > 1
        }
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
        where: { id: walletId, userId }
      });

      if (!wallet) {
        throw new CryptoServiceError(
          'Wallet not found',
          CryptoErrorCodes.WALLET_NOT_FOUND,
          404
        );
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
          { description: { contains: filters.search, mode: 'insensitive' } }
        ];
      }

      // Get total count
      const total = await prisma.cryptoNFT.count({ where });

      // Get NFTs
      const nfts = await prisma.cryptoNFT.findMany({
        where,
        orderBy: [
          { estimatedValue: 'desc' },
          { createdAt: 'desc' }
        ],
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit
      });

      const pages = Math.ceil(total / pagination.limit);

      return {
        data: nfts,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages,
          hasNext: pagination.page < pages,
          hasPrev: pagination.page > 1
        }
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
        where: { id: walletId, userId }
      });

      if (!wallet) {
        throw new CryptoServiceError(
          'Wallet not found',
          CryptoErrorCodes.WALLET_NOT_FOUND,
          404
        );
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
        take: pagination.limit
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
          hasPrev: pagination.page > 1
        }
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

  private async scheduleWalletSync(_userId: string, walletId: string, fullSync: boolean = false) {
    // This would integrate with your BullMQ job queue
    // For now, we'll just log the intention
    logger.info(`Scheduling wallet sync for ${walletId}, fullSync: ${fullSync}`);
    
    // TODO: Add to job queue
    // await this.jobQueue.add('syncWallet', { userId, walletId, fullSync });
  }

  private async clearWalletCache(walletId: string) {
    const keys = [
      `${CacheKeys.WALLET_PORTFOLIO}:${walletId}`,
      `${CacheKeys.WALLET_TRANSACTIONS}:${walletId}`,
      `${CacheKeys.WALLET_NFTS}:${walletId}`,
      `${CacheKeys.WALLET_DEFI}:${walletId}`
    ];
    
    await Promise.all(keys.map(key => this.redis.del(key)));
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
        return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || /^bc1[a-z0-9]{39,59}$/.test(address);
      default:
        return true; // Allow unknown networks for now
    }
  }
}

export const cryptoService = new CryptoService();