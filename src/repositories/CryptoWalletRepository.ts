import { PrismaClient, CryptoWallet, BlockchainNetwork } from '@prisma/client';
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { logger } from '@/utils/logger';

export interface WalletFilters {
  userId?: string;
  isActive?: boolean;
  isWatching?: boolean;
  networks?: BlockchainNetwork[];
  hasPositions?: boolean;
  minBalance?: number;
  search?: string;
}

export interface WalletWithStats extends CryptoWallet {
  stats: {
    totalBalanceUsd: number;
    assetCount: number;
    nftCount: number;
    transactionCount: number;
    defiPositionCount: number;
    lastSyncAt: Date | null;
  };
}

export class CryptoWalletRepository extends BaseRepository<CryptoWallet> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'cryptoWallet');
  }

  /**
   * Find wallet by ID with user ownership check
   */
  async findByIdAndUser(walletId: string, userId: string): Promise<CryptoWallet | null> {
    return this.executeWithMetrics(
      'findByIdAndUser',
      async () => {
        return this.prisma.cryptoWallet.findFirst({
          where: {
            id: walletId,
            userId,
          },
        });
      },
      { walletId, userId }
    );
  }

  /**
   * Find wallet by address and network
   */
  async findByAddressAndNetwork(
    address: string,
    network: BlockchainNetwork,
    userId?: string
  ): Promise<CryptoWallet | null> {
    return this.executeWithMetrics(
      'findByAddressAndNetwork',
      async () => {
        const where: any = {
          address: address.toLowerCase(),
          network,
        };

        if (userId) {
          where.userId = userId;
        }

        return this.prisma.cryptoWallet.findFirst({ where });
      },
      { address: address.substring(0, 8) + '...', network, userId }
    );
  }

  /**
   * Get user wallets with advanced filtering and pagination
   */
  async findUserWallets(
    userId: string,
    filters: WalletFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<PaginatedResult<WalletWithStats>> {
    const where: any = {
      userId,
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.isWatching !== undefined && { isWatching: filters.isWatching }),
      ...(filters.networks?.length && { network: { in: filters.networks } }),
    };

    // Add search filter
    if (filters.search) {
      where.OR = [
        { address: { contains: filters.search, mode: 'insensitive' } },
        { name: { contains: filters.search, mode: 'insensitive' } },
        { label: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Filter by balance if specified
    if (filters.minBalance !== undefined) {
      where.totalBalanceUsd = { gte: filters.minBalance };
    }

    return this.executeWithMetrics(
      'findUserWallets',
      async () => {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;

        const [wallets, total] = await Promise.all([
          this.prisma.cryptoWallet.findMany({
            where,
            include: {
              _count: {
                select: {
                  positions: true,
                  nfts: true,
                  transactions: true,
                  defiAppPositions: true,
                },
              },
              portfolio: {
                select: {
                  totalPositionsValue: true,
                  lastSyncAt: true,
                },
              },
            },
            orderBy: [{ totalBalanceUsd: 'desc' }, { createdAt: 'desc' }],
            skip,
            take: limit,
          }),
          this.prisma.cryptoWallet.count({ where }),
        ]);

        // Transform to include stats
        const walletsWithStats: WalletWithStats[] = wallets.map((wallet) => ({
          ...wallet,
          stats: {
            totalBalanceUsd: wallet.totalBalanceUsd.toNumber(),
            assetCount: wallet._count.positions,
            nftCount: wallet._count.nfts,
            transactionCount: wallet._count.transactions,
            defiPositionCount: wallet._count.defiAppPositions,
            lastSyncAt: wallet.portfolio?.lastSyncAt || null,
          },
        }));

        const pages = Math.ceil(total / limit);

        return {
          data: walletsWithStats,
          pagination: {
            page,
            limit,
            total,
            pages,
            hasNext: page < pages,
            hasPrev: page > 1,
          },
        };
      },
      { userId, filters, pagination }
    );
  }

  /**
   * Get wallet portfolio summary efficiently
   */
  async getWalletPortfolioSummary(walletId: string): Promise<{
    totalValue: number;
    assetValue: number;
    defiValue: number;
    nftValue: number;
    assetCount: number;
    nftCount: number;
    defiPositionCount: number;
    lastSyncAt: Date | null;
  }> {
    return this.executeWithMetrics(
      'getWalletPortfolioSummary',
      async () => {
        const [assetSummary, nftSummary, defiSummary, portfolio] = await Promise.all([
          // Asset summary
          this.prisma.cryptoPosition.aggregate({
            where: { walletId },
            _sum: { balanceUsd: true },
            _count: true,
          }),

          // NFT summary
          this.prisma.cryptoNFT.aggregate({
            where: { walletId },
            _sum: { estimatedValue: true },
            _count: true,
          }),

          // DeFi summary
          this.prisma.deFiAppPosition.aggregate({
            where: { walletId, isActive: true },
            _sum: { balanceUSD: true },
            _count: true,
          }),

          // Portfolio metadata
          this.prisma.cryptoPortfolio.findFirst({
            where: { walletId },
            select: { lastSyncAt: true },
          }),
        ]);

        const assetValue = assetSummary._sum.balanceUsd?.toNumber() || 0;
        const nftValue = nftSummary._sum.estimatedValue?.toNumber() || 0;
        const defiValue = defiSummary._sum.balanceUSD?.toNumber() || 0;

        return {
          totalValue: assetValue + nftValue + defiValue,
          assetValue,
          defiValue,
          nftValue,
          assetCount: assetSummary._count,
          nftCount: nftSummary._count,
          defiPositionCount: defiSummary._count,
          lastSyncAt: portfolio?.lastSyncAt || null,
        };
      },
      { walletId }
    );
  }

  /**
   * Bulk update wallet balances efficiently
   */
  async bulkUpdateBalances(
    updates: Array<{
      walletId: string;
      totalBalanceUsd: number;
      assetCount: number;
      nftCount: number;
    }>
  ): Promise<number> {
    return this.executeWithMetrics(
      'bulkUpdateBalances',
      async () => {
        let updatedCount = 0;

        // Use batch processing to avoid overwhelming the database
        const batches = this.chunk(updates, 50);

        for (const batch of batches) {
          await this.prisma.$transaction(
            batch.map((update) =>
              this.prisma.cryptoWallet.update({
                where: { id: update.walletId },
                data: {
                  totalBalanceUsd: update.totalBalanceUsd,
                  assetCount: update.assetCount,
                  nftCount: update.nftCount,
                  updatedAt: new Date(),
                },
              })
            )
          );

          updatedCount += batch.length;
        }

        return updatedCount;
      },
      { updateCount: updates.length }
    );
  }

  /**
   * Update wallet sync status
   */
  async updateSyncStatus(walletId: string, status: string, error?: string): Promise<CryptoWallet> {
    return this.executeWithMetrics(
      'updateSyncStatus',
      async () => {
        return this.prisma.cryptoWallet.update({
          where: { id: walletId },
          data: {
            syncStatus: status,
            syncError: error || null,
            lastSyncAt: status === 'COMPLETED' ? new Date() : undefined,
            updatedAt: new Date(),
          },
        });
      },
      { walletId, status, hasError: !!error }
    );
  }

  /**
   * Get wallets that need syncing
   */
  async getWalletsNeedingSync(
    limit = 50,
    maxAge = 30 * 60 * 1000 // 30 minutes
  ): Promise<CryptoWallet[]> {
    return this.executeWithMetrics(
      'getWalletsNeedingSync',
      async () => {
        const cutoffTime = new Date(Date.now() - maxAge);

        return this.prisma.cryptoWallet.findMany({
          where: {
            isActive: true,
            isWatching: true,
            OR: [
              { lastSyncAt: { lt: cutoffTime } },
              { lastSyncAt: null },
              { syncStatus: 'FAILED' },
            ],
            syncStatus: { not: 'IN_PROGRESS' },
          },
          orderBy: [{ lastSyncAt: 'asc' }, { createdAt: 'asc' }],
          take: limit,
        });
      },
      { limit, maxAge }
    );
  }

  /**
   * Get user wallet statistics
   */
  async getUserWalletStats(userId: string): Promise<{
    totalWallets: number;
    activeWallets: number;
    totalValue: number;
    networks: Record<string, number>;
    syncStatus: Record<string, number>;
  }> {
    return this.executeWithMetrics(
      'getUserWalletStats',
      async () => {
        const [totalStats, networkStats, syncStats, valueSum] = await Promise.all([
          // Basic counts
          this.prisma.cryptoWallet.groupBy({
            by: ['isActive'],
            where: { userId },
            _count: true,
          }),

          // Network distribution
          this.prisma.cryptoWallet.groupBy({
            by: ['network'],
            where: { userId, isActive: true },
            _count: true,
          }),

          // Sync status distribution
          this.prisma.cryptoWallet.groupBy({
            by: ['syncStatus'],
            where: { userId, isActive: true },
            _count: true,
          }),

          // Total value
          this.prisma.cryptoWallet.aggregate({
            where: { userId, isActive: true },
            _sum: { totalBalanceUsd: true },
          }),
        ]);

        const totalWallets = totalStats.reduce((sum, stat) => sum + stat._count, 0);
        const activeWallets = totalStats.find((s) => s.isActive)?._count || 0;

        const networks = networkStats.reduce(
          (acc, stat) => {
            acc[stat.network] = stat._count;
            return acc;
          },
          {} as Record<string, number>
        );

        const syncStatus = syncStats.reduce(
          (acc, stat) => {
            acc[stat.syncStatus || 'UNKNOWN'] = stat._count;
            return acc;
          },
          {} as Record<string, number>
        );

        return {
          totalWallets,
          activeWallets,
          totalValue: valueSum._sum.totalBalanceUsd?.toNumber() || 0,
          networks,
          syncStatus,
        };
      },
      { userId }
    );
  }

  /**
   * Clean up orphaned wallets (no positions, transactions, or NFTs)
   */
  async cleanupOrphanedWallets(userId: string, daysOld = 30): Promise<number> {
    return this.executeWithMetrics(
      'cleanupOrphanedWallets',
      async () => {
        const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

        // Find wallets with no data
        const orphanedWallets = await this.prisma.cryptoWallet.findMany({
          where: {
            userId,
            createdAt: { lt: cutoffDate },
            totalBalanceUsd: 0,
            assetCount: 0,
            nftCount: 0,
            positions: { none: {} },
            transactions: { none: {} },
            nfts: { none: {} },
            defiAppPositions: { none: {} },
          },
          select: { id: true },
        });

        if (orphanedWallets.length === 0) {
          return 0;
        }

        // Delete orphaned wallets
        const result = await this.prisma.cryptoWallet.deleteMany({
          where: {
            id: { in: orphanedWallets.map((w) => w.id) },
          },
        });

        logger.info('Cleaned up orphaned wallets', {
          userId,
          deletedCount: result.count,
          cutoffDate,
        });

        return result.count;
      },
      { userId, daysOld }
    );
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
