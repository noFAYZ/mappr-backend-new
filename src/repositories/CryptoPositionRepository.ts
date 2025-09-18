import { PrismaClient, CryptoPosition, BlockchainNetwork } from '@prisma/client';
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { logger } from '@/utils/logger';

export interface PositionFilters {
  walletId?: string;
  assetId?: string;
  networks?: BlockchainNetwork[];
  minBalance?: number;
  hasBalance?: boolean;
  search?: string;
}

export interface PositionWithAsset extends CryptoPosition {
  asset: {
    id: string;
    symbol: string;
    name: string;
    logoUrl: string | null;
    priceUsd: number;
    change24h: number | null;
    network: BlockchainNetwork;
    contractAddress: string | null;
  };
}

export interface PortfolioSummary {
  totalValue: number;
  totalPositions: number;
  topPositions: PositionWithAsset[];
  networkDistribution: Array<{
    network: BlockchainNetwork;
    value: number;
    percentage: number;
    count: number;
  }>;
  assetDistribution: Array<{
    symbol: string;
    value: number;
    percentage: number;
    balance: number;
  }>;
}

export class CryptoPositionRepository extends BaseRepository<CryptoPosition> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'cryptoPosition');
  }

  /**
   * Get positions for a wallet with asset details
   */
  async findWalletPositions(
    walletId: string,
    filters: Omit<PositionFilters, 'walletId'> = {},
    pagination: PaginationOptions = { page: 1, limit: 50 }
  ): Promise<PaginatedResult<PositionWithAsset>> {
    const where: any = {
      walletId,
      ...(filters.assetId && { assetId: filters.assetId }),
      ...(filters.minBalance && { balanceUsd: { gte: filters.minBalance } }),
      ...(filters.hasBalance && { balanceUsd: { gt: 0 } }),
    };

    // Add network filter through asset relationship
    if (filters.networks?.length) {
      where.asset = {
        network: { in: filters.networks },
      };
    }

    // Add search filter
    if (filters.search) {
      where.OR = [
        { asset: { symbol: { contains: filters.search, mode: 'insensitive' } } },
        { asset: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    return this.executeWithMetrics(
      'findWalletPositions',
      async () => {
        const { page, limit, orderBy = { balanceUsd: 'desc' } } = pagination;
        const skip = (page - 1) * limit;

        const [positions, total] = await Promise.all([
          this.prisma.cryptoPosition.findMany({
            where,
            include: {
              asset: {
                select: {
                  id: true,
                  symbol: true,
                  name: true,
                  logoUrl: true,
                  priceUsd: true,
                  change24h: true,
                  network: true,
                  contractAddress: true,
                },
              },
            },
            orderBy,
            skip,
            take: limit,
          }),
          this.prisma.cryptoPosition.count({ where }),
        ]);

        const pages = Math.ceil(total / limit);

        // Transform positions to match interface types
        const transformedPositions: PositionWithAsset[] = positions.map((pos: any) => ({
          ...pos,
          asset: pos.asset ? {
            ...pos.asset,
            priceUsd: pos.asset.priceUsd?.toNumber() || 0,
            change24h: pos.asset.change24h?.toNumber() || null,
          } : null,
        }));

        return {
          data: transformedPositions,
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
      { walletId, filters, pagination }
    );
  }

  /**
   * Get portfolio summary with analytics
   */
  async getPortfolioSummary(walletId: string): Promise<PortfolioSummary> {
    return this.executeWithMetrics(
      'getPortfolioSummary',
      async () => {
        // Get all positions with assets
        const positions = await this.prisma.cryptoPosition.findMany({
          where: {
            walletId,
            balanceUsd: { gt: 0 },
          },
          include: {
            asset: {
              select: {
                id: true,
                symbol: true,
                name: true,
                logoUrl: true,
                priceUsd: true,
                change24h: true,
                network: true,
                contractAddress: true,
              },
            },
          },
          orderBy: { balanceUsd: 'desc' },
        });

        const totalValue = positions.reduce((sum, pos) => sum + pos.balanceUsd.toNumber(), 0);

        // Network distribution
        const networkMap = new Map<BlockchainNetwork, { value: number; count: number }>();
        positions.forEach((pos) => {
          if (pos.asset) {
            const network = pos.asset.network;
            const existing = networkMap.get(network) || { value: 0, count: 0 };
            networkMap.set(network, {
              value: existing.value + pos.balanceUsd.toNumber(),
              count: existing.count + 1,
            });
          }
        });

        const networkDistribution = Array.from(networkMap.entries())
          .map(([network, data]) => ({
            network,
            value: data.value,
            percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
            count: data.count,
          }))
          .sort((a, b) => b.value - a.value);

        // Asset distribution (top 10)
        const assetDistribution = positions.slice(0, 10)
          .filter(pos => pos.asset) // Only include positions with assets
          .map((pos) => ({
            symbol: pos.asset!.symbol,
            value: pos.balanceUsd.toNumber(),
            percentage: totalValue > 0 ? (pos.balanceUsd.toNumber() / totalValue) * 100 : 0,
            balance: pos.balance.toNumber(),
          }));

        return {
          totalValue,
          totalPositions: positions.length,
          topPositions: positions.slice(0, 10).map((pos: any) => ({
            ...pos,
            asset: pos.asset ? {
              ...pos.asset,
              priceUsd: pos.asset.priceUsd?.toNumber() || 0,
              change24h: pos.asset.change24h?.toNumber() || null,
            } : null,
          })) as PositionWithAsset[],
          networkDistribution,
          assetDistribution,
        };
      },
      { walletId }
    );
  }

  /**
   * Bulk update positions efficiently
   */
  async bulkUpsertPositions(
    positions: Array<{
      walletId: string;
      assetId: string;
      balance: number;
      balanceUsd: number;
      price?: number;
    }>
  ): Promise<number> {
    return this.executeWithMetrics(
      'bulkUpsertPositions',
      async () => {
        let upsertedCount = 0;
        const batchSize = 50;

        // Process in batches to avoid overwhelming the database
        for (let i = 0; i < positions.length; i += batchSize) {
          const batch = positions.slice(i, i + batchSize);

          await this.withTransaction(async (tx) => {
            const upsertPromises = batch.map((position) =>
              tx.cryptoPosition.upsert({
                where: {
                  walletId_assetId: {
                    walletId: position.walletId,
                    assetId: position.assetId,
                  },
                },
                update: {
                  balance: position.balance,
                  balanceUsd: position.balanceUsd,
                  balanceFormatted: position.balance.toString(),
                  lastUpdated: new Date(),
                },
                create: {
                  walletId: position.walletId,
                  assetId: position.assetId,
                  balance: position.balance,
                  balanceUsd: position.balanceUsd,
                  balanceFormatted: position.balance.toString(),
                  lastUpdated: new Date(),
                },
              })
            );

            await Promise.all(upsertPromises);
            upsertedCount += batch.length;
          });
        }

        return upsertedCount;
      },
      { positionCount: positions.length }
    );
  }

  /**
   * Get positions by asset across all wallets
   */
  async findPositionsByAsset(
    assetId: string,
    userId?: string,
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<PaginatedResult<CryptoPosition & { wallet: { address: string; name: string } }>> {
    const where: any = {
      assetId,
      balanceUsd: { gt: 0 },
    };

    if (userId) {
      where.wallet = { userId };
    }

    return this.executeWithMetrics(
      'findPositionsByAsset',
      async () => {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;

        const [positions, total] = await Promise.all([
          this.prisma.cryptoPosition.findMany({
            where,
            include: {
              wallet: {
                select: {
                  address: true,
                  name: true,
                },
              },
            },
            orderBy: { balanceUsd: 'desc' },
            skip,
            take: limit,
          }),
          this.prisma.cryptoPosition.count({ where }),
        ]);

        const pages = Math.ceil(total / limit);

        return {
          data: positions,
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
      { assetId, userId: userId || 'all', pagination }
    );
  }

  /**
   * Get historical balance changes for analysis
   */
  async getBalanceHistory(
    walletId: string,
    assetId?: string,
    days = 30
  ): Promise<
    Array<{
      date: Date;
      totalBalanceUsd: number;
      positionCount: number;
    }>
  > {
    return this.executeWithMetrics(
      'getBalanceHistory',
      async () => {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const where: any = {
          walletId,
          lastUpdated: { gte: cutoffDate },
        };

        if (assetId) {
          where.assetId = assetId;
        }

        // This is a simplified version - in production, you'd want to store historical snapshots
        const positions = await this.prisma.cryptoPosition.findMany({
          where,
          select: {
            balanceUsd: true,
            lastUpdated: true,
          },
          orderBy: { lastUpdated: 'asc' },
        });

        // Group by day
        const dailyData = new Map<string, { totalBalanceUsd: number; count: number }>();

        positions.forEach((pos) => {
          const dateKey = pos.lastUpdated.toISOString().split('T')[0];
          const existing = dailyData.get(dateKey) || { totalBalanceUsd: 0, count: 0 };
          dailyData.set(dateKey, {
            totalBalanceUsd: existing.totalBalanceUsd + pos.balanceUsd.toNumber(),
            count: existing.count + 1,
          });
        });

        return Array.from(dailyData.entries())
          .map(([dateStr, data]) => ({
            date: new Date(dateStr),
            totalBalanceUsd: data.totalBalanceUsd,
            positionCount: data.count,
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());
      },
      { walletId, assetId: assetId || 'all', days }
    );
  }

  /**
   * Clean up zero-balance positions
   */
  async cleanupZeroPositions(walletId?: string, daysOld = 7): Promise<number> {
    return this.executeWithMetrics(
      'cleanupZeroPositions',
      async () => {
        const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

        const where: any = {
          balanceUsd: { lte: 0.01 }, // Positions worth less than 1 cent
          lastUpdated: { lt: cutoffDate },
        };

        if (walletId) {
          where.walletId = walletId;
        }

        const result = await this.prisma.cryptoPosition.deleteMany({ where });

        logger.info('Cleaned up zero-balance positions', {
          walletId,
          deletedCount: result.count,
          cutoffDate,
        });

        return result.count;
      },
      { walletId, daysOld }
    );
  }

  /**
   * Get top gainers/losers for a wallet
   */
  async getTopMovers(
    walletId: string,
    limit = 10
  ): Promise<{
    gainers: PositionWithAsset[];
    losers: PositionWithAsset[];
  }> {
    return this.executeWithMetrics(
      'getTopMovers',
      async () => {
        const positions = await this.prisma.cryptoPosition.findMany({
          where: {
            walletId,
            balanceUsd: { gt: 10 }, // Only positions worth more than $10
          },
          include: {
            asset: {
              select: {
                id: true,
                symbol: true,
                name: true,
                logoUrl: true,
                priceUsd: true,
                change24h: true,
                network: true,
                contractAddress: true,
              },
            },
          },
        });

        // Transform and filter positions with price change data
        const transformedPositions: PositionWithAsset[] = positions
          .filter((pos: any) => pos.asset && pos.asset.change24h !== null)
          .map((pos: any) => ({
            ...pos,
            asset: {
              ...pos.asset,
              priceUsd: pos.asset.priceUsd?.toNumber() || 0,
              change24h: pos.asset.change24h?.toNumber() || null,
            }
          }));

        // Sort by 24h change
        const gainers = transformedPositions
          .filter((pos) => pos.asset.change24h! > 0)
          .sort((a, b) => b.asset.change24h! - a.asset.change24h!)
          .slice(0, limit);

        const losers = transformedPositions
          .filter((pos) => pos.asset.change24h! < 0)
          .sort((a, b) => a.asset.change24h! - b.asset.change24h!)
          .slice(0, limit);

        return { gainers, losers };
      },
      { walletId, limit }
    );
  }

  /**
   * Update position prices based on current market data
   */
  async updatePositionPrices(
    priceUpdates: Array<{
      assetId: string;
      priceUsd: number;
      change24h?: number;
    }>
  ): Promise<number> {
    return this.executeWithMetrics(
      'updatePositionPrices',
      async () => {
        let updatedCount = 0;

        // Process in batches
        const batchSize = 20;
        for (let i = 0; i < priceUpdates.length; i += batchSize) {
          const batch = priceUpdates.slice(i, i + batchSize);

          await this.withTransaction(async (tx) => {
            const updatePromises = batch.map(async (update) => {
              // Update all positions for this asset
              const result = await tx.cryptoPosition.updateMany({
                where: { assetId: update.assetId },
                data: {
                  price: update.priceUsd,
                  // Recalculate balanceUsd based on new price
                  // This would need to be done with raw SQL for efficiency
                  lastUpdated: new Date(),
                },
              });

              // Then update balanceUsd with raw SQL for efficiency
              await tx.$executeRaw`
                UPDATE crypto_positions
                SET "balanceUsd" = balance * ${update.priceUsd}
                WHERE "assetId" = ${update.assetId}
              `;

              return result.count;
            });

            const results = await Promise.all(updatePromises);
            updatedCount += results.reduce((sum, count) => sum + count, 0);
          });
        }

        logger.info('Updated position prices', {
          assetsUpdated: priceUpdates.length,
          positionsUpdated: updatedCount,
        });

        return updatedCount;
      },
      { updateCount: priceUpdates.length }
    );
  }
}
