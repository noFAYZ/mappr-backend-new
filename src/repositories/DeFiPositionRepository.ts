import { PrismaClient, DeFiAppPosition, BlockchainNetwork } from '@prisma/client';
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { logger } from '@/utils/logger';

export interface DeFiPositionFilters {
  walletId?: string;
  appId?: string;
  networks?: BlockchainNetwork[];
  metaTypes?: string[];
  minBalance?: number;
  isActive?: boolean;
  search?: string;
}

export interface DeFiPositionWithApp extends DeFiAppPosition {
  app: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    website: string | null;
    category: string | null;
    isVerified: boolean;
    network: BlockchainNetwork;
  };
}

export interface DeFiProtocolSummary {
  totalValue: number;
  totalPositions: number;
  protocolDistribution: Array<{
    appName: string;
    appSlug: string;
    value: number;
    percentage: number;
    positionCount: number;
    category: string | null;
  }>;
  categoryDistribution: Array<{
    category: string;
    value: number;
    percentage: number;
    positionCount: number;
  }>;
  networkDistribution: Array<{
    network: BlockchainNetwork;
    value: number;
    percentage: number;
    positionCount: number;
  }>;
  metaTypeDistribution: Array<{
    metaType: string;
    value: number;
    percentage: number;
    positionCount: number;
  }>;
}

export class DeFiPositionRepository extends BaseRepository<DeFiAppPosition> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'deFiAppPosition');
  }

  /**
   * Get DeFi positions for a wallet with app details
   */
  async findWalletPositions(
    walletId: string,
    filters: Omit<DeFiPositionFilters, 'walletId'> = {},
    pagination: PaginationOptions = { page: 1, limit: 50 }
  ): Promise<PaginatedResult<DeFiPositionWithApp>> {
    const where: any = {
      walletId,
      ...(filters.appId && { appId: filters.appId }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.minBalance && { balanceUSD: { gte: filters.minBalance } }),
      ...(filters.metaTypes?.length && { metaType: { in: filters.metaTypes } }),
    };

    // Add network filter through app relationship
    if (filters.networks?.length) {
      where.app = {
        ...where.app,
        network: { in: filters.networks },
      };
    }

    // Add search filter
    if (filters.search) {
      where.OR = [
        { app: { name: { contains: filters.search, mode: 'insensitive' } } },
        { app: { slug: { contains: filters.search, mode: 'insensitive' } } },
        { metaType: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.executeWithMetrics(
      'findWalletPositions',
      async () => {
        const { page, limit, orderBy = { balanceUSD: 'desc' } } = pagination;
        const skip = (page - 1) * limit;

        const [positions, total] = await Promise.all([
          this.prisma.deFiAppPosition.findMany({
            where,
            include: {
              app: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  logoUrl: true,
                  website: true,
                  category: true,
                  isVerified: true,
                  network: true,
                },
              },
            },
            orderBy,
            skip,
            take: limit,
          }),
          this.prisma.deFiAppPosition.count({ where }),
        ]);

        const pages = Math.ceil(total / limit);

        return {
          data: positions as DeFiPositionWithApp[],
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
   * Get DeFi protocol summary with analytics
   */
  async getProtocolSummary(walletId: string): Promise<DeFiProtocolSummary> {
    return this.executeWithMetrics(
      'getProtocolSummary',
      async () => {
        // Get all active positions with apps
        const positions = await this.prisma.deFiAppPosition.findMany({
          where: {
            walletId,
            isActive: true,
            balanceUSD: { gt: 0 },
          },
          include: {
            app: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                category: true,
                isVerified: true,
                network: true,
              },
            },
          },
        });

        const totalValue = positions.reduce((sum, pos) => sum + pos.balanceUSD.toNumber(), 0);

        // Protocol distribution
        const protocolMap = new Map<
          string,
          {
            appName: string;
            appSlug: string;
            value: number;
            count: number;
            category: string | null;
          }
        >();

        positions.forEach((pos) => {
          const key = pos.app.id;
          const existing = protocolMap.get(key) || {
            appName: pos.app.name,
            appSlug: pos.app.slug,
            value: 0,
            count: 0,
            category: pos.app.category,
          };
          protocolMap.set(key, {
            ...existing,
            value: existing.value + pos.balanceUSD.toNumber(),
            count: existing.count + 1,
          });
        });

        const protocolDistribution = Array.from(protocolMap.values())
          .map((data) => ({
            appName: data.appName,
            appSlug: data.appSlug,
            value: data.value,
            percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
            positionCount: data.count,
            category: data.category,
          }))
          .sort((a, b) => b.value - a.value);

        // Category distribution
        const categoryMap = new Map<string, { value: number; count: number }>();
        positions.forEach((pos) => {
          const category = pos.app.category || 'Other';
          const existing = categoryMap.get(category) || { value: 0, count: 0 };
          categoryMap.set(category, {
            value: existing.value + pos.balanceUSD.toNumber(),
            count: existing.count + 1,
          });
        });

        const categoryDistribution = Array.from(categoryMap.entries())
          .map(([category, data]) => ({
            category,
            value: data.value,
            percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
            positionCount: data.count,
          }))
          .sort((a, b) => b.value - a.value);

        // Network distribution
        const networkMap = new Map<BlockchainNetwork, { value: number; count: number }>();
        positions.forEach((pos) => {
          const network = pos.app.network;
          const existing = networkMap.get(network) || { value: 0, count: 0 };
          networkMap.set(network, {
            value: existing.value + pos.balanceUSD.toNumber(),
            count: existing.count + 1,
          });
        });

        const networkDistribution = Array.from(networkMap.entries())
          .map(([network, data]) => ({
            network,
            value: data.value,
            percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
            positionCount: data.count,
          }))
          .sort((a, b) => b.value - a.value);

        // Meta type distribution
        const metaTypeMap = new Map<string, { value: number; count: number }>();
        positions.forEach((pos) => {
          const metaType = pos.metaType || 'Unknown';
          const existing = metaTypeMap.get(metaType) || { value: 0, count: 0 };
          metaTypeMap.set(metaType, {
            value: existing.value + pos.balanceUSD.toNumber(),
            count: existing.count + 1,
          });
        });

        const metaTypeDistribution = Array.from(metaTypeMap.entries())
          .map(([metaType, data]) => ({
            metaType,
            value: data.value,
            percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
            positionCount: data.count,
          }))
          .sort((a, b) => b.value - a.value);

        return {
          totalValue,
          totalPositions: positions.length,
          protocolDistribution,
          categoryDistribution,
          networkDistribution,
          metaTypeDistribution,
        };
      },
      { walletId }
    );
  }

  /**
   * Bulk upsert DeFi positions
   */
  async bulkUpsertPositions(
    positions: Array<{
      walletId: string;
      appId: string;
      positionKey: string;
      metaType?: string;
      balanceUSD: number;
      isActive: boolean;
      data?: Record<string, any>;
    }>
  ): Promise<number> {
    return this.executeWithMetrics(
      'bulkUpsertPositions',
      async () => {
        let upsertedCount = 0;
        const batchSize = 50;

        // Process in batches
        for (let i = 0; i < positions.length; i += batchSize) {
          const batch = positions.slice(i, i + batchSize);

          await this.withTransaction(async (tx) => {
            const upsertPromises = batch.map((position) =>
              tx.deFiAppPosition.upsert({
                where: {
                  walletId_appId_positionKey: {
                    walletId: position.walletId,
                    appId: position.appId,
                    positionKey: position.positionKey,
                  },
                },
                update: {
                  metaType: position.metaType,
                  balanceUSD: position.balanceUSD,
                  isActive: position.isActive,
                  data: position.data,
                  updatedAt: new Date(),
                },
                create: {
                  walletId: position.walletId,
                  appId: position.appId,
                  positionKey: position.positionKey,
                  metaType: position.metaType,
                  balanceUSD: position.balanceUSD,
                  isActive: position.isActive,
                  data: position.data,
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
   * Get top protocols by TVL
   */
  async getTopProtocols(
    userId?: string,
    limit = 10
  ): Promise<
    Array<{
      appId: string;
      appName: string;
      appSlug: string;
      category: string | null;
      totalValueLocked: number;
      uniqueUsers: number;
      positionCount: number;
    }>
  > {
    return this.executeWithMetrics(
      'getTopProtocols',
      async () => {
        const where: any = {
          isActive: true,
          balanceUSD: { gt: 0 },
        };

        if (userId) {
          where.wallet = { userId };
        }

        const result = await this.prisma.deFiAppPosition.groupBy({
          by: ['appId'],
          where,
          _sum: {
            balanceUSD: true,
          },
          _count: {
            _all: true,
            walletId: true,
          },
          orderBy: {
            _sum: {
              balanceUSD: 'desc',
            },
          },
          take: limit,
        });

        // Get app details
        const appIds = result.map((r) => r.appId);
        const apps = await this.prisma.deFiApp.findMany({
          where: { id: { in: appIds } },
          select: {
            id: true,
            name: true,
            slug: true,
            category: true,
          },
        });

        const appMap = new Map(apps.map((app) => [app.id, app]));

        return result.map((item) => {
          const app = appMap.get(item.appId);
          return {
            appId: item.appId,
            appName: app?.name || 'Unknown',
            appSlug: app?.slug || '',
            category: app?.category,
            totalValueLocked: item._sum.balanceUSD?.toNumber() || 0,
            uniqueUsers: item._count.walletId,
            positionCount: item._count._all,
          };
        });
      },
      { userId, limit }
    );
  }

  /**
   * Get DeFi positions by protocol
   */
  async getPositionsByProtocol(
    appSlug: string,
    userId?: string,
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<PaginatedResult<DeFiPositionWithApp>> {
    const where: any = {
      app: { slug: appSlug },
      isActive: true,
      balanceUSD: { gt: 0 },
    };

    if (userId) {
      where.wallet = { userId };
    }

    return this.executeWithMetrics(
      'getPositionsByProtocol',
      async () => {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;

        const [positions, total] = await Promise.all([
          this.prisma.deFiAppPosition.findMany({
            where,
            include: {
              app: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  logoUrl: true,
                  website: true,
                  category: true,
                  isVerified: true,
                  network: true,
                },
              },
              wallet: {
                select: {
                  address: true,
                  name: true,
                },
              },
            },
            orderBy: { balanceUSD: 'desc' },
            skip,
            take: limit,
          }),
          this.prisma.deFiAppPosition.count({ where }),
        ]);

        const pages = Math.ceil(total / limit);

        return {
          data: positions as DeFiPositionWithApp[],
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
      { appSlug, userId, pagination }
    );
  }

  /**
   * Get DeFi yield farming positions
   */
  async getYieldPositions(walletId: string, minApr = 5.0): Promise<DeFiPositionWithApp[]> {
    return this.executeWithMetrics(
      'getYieldPositions',
      async () => {
        // This would need to be implemented based on how you store yield data
        // For now, filtering by common yield meta types
        const yieldMetaTypes = ['lending', 'liquidity-pool', 'farming', 'staking', 'vault'];

        return this.prisma.deFiAppPosition.findMany({
          where: {
            walletId,
            isActive: true,
            balanceUSD: { gt: 10 },
            metaType: { in: yieldMetaTypes },
          },
          include: {
            app: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                website: true,
                category: true,
                isVerified: true,
                network: true,
              },
            },
          },
          orderBy: { balanceUSD: 'desc' },
        }) as Promise<DeFiPositionWithApp[]>;
      },
      { walletId, minApr }
    );
  }

  /**
   * Clean up inactive positions
   */
  async cleanupInactivePositions(walletId?: string, daysOld = 30): Promise<number> {
    return this.executeWithMetrics(
      'cleanupInactivePositions',
      async () => {
        const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

        const where: any = {
          isActive: false,
          balanceUSD: { lte: 0.01 }, // Less than 1 cent
          updatedAt: { lt: cutoffDate },
        };

        if (walletId) {
          where.walletId = walletId;
        }

        const result = await this.prisma.deFiAppPosition.deleteMany({ where });

        logger.info('Cleaned up inactive DeFi positions', {
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
   * Get position value changes over time
   */
  async getPositionValueHistory(
    walletId: string,
    days = 30
  ): Promise<
    Array<{
      date: Date;
      totalValue: number;
      positionCount: number;
      protocolCount: number;
    }>
  > {
    return this.executeWithMetrics(
      'getPositionValueHistory',
      async () => {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // This is a simplified version - in production, you'd want historical snapshots
        const positions = await this.prisma.deFiAppPosition.findMany({
          where: {
            walletId,
            updatedAt: { gte: cutoffDate },
            isActive: true,
          },
          select: {
            balanceUSD: true,
            updatedAt: true,
            appId: true,
          },
          orderBy: { updatedAt: 'asc' },
        });

        // Group by day
        const dailyData = new Map<
          string,
          {
            totalValue: number;
            positionCount: number;
            protocols: Set<string>;
          }
        >();

        positions.forEach((pos) => {
          const dateKey = pos.updatedAt.toISOString().split('T')[0];
          const existing = dailyData.get(dateKey) || {
            totalValue: 0,
            positionCount: 0,
            protocols: new Set<string>(),
          };

          existing.totalValue += pos.balanceUSD.toNumber();
          existing.positionCount += 1;
          existing.protocols.add(pos.appId);

          dailyData.set(dateKey, existing);
        });

        return Array.from(dailyData.entries())
          .map(([dateStr, data]) => ({
            date: new Date(dateStr),
            totalValue: data.totalValue,
            positionCount: data.positionCount,
            protocolCount: data.protocols.size,
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());
      },
      { walletId, days }
    );
  }

  /**
   * Mark positions as inactive based on balance threshold
   */
  async markInactivePositions(minBalanceUsd = 0.01, batchSize = 100): Promise<number> {
    return this.executeWithMetrics(
      'markInactivePositions',
      async () => {
        const result = await this.prisma.deFiAppPosition.updateMany({
          where: {
            balanceUSD: { lt: minBalanceUsd },
            isActive: true,
          },
          data: {
            isActive: false,
            updatedAt: new Date(),
          },
        });

        logger.info('Marked positions as inactive', {
          updatedCount: result.count,
          minBalanceUsd,
        });

        return result.count;
      },
      { minBalanceUsd, batchSize }
    );
  }
}
