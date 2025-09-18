import {
  PrismaClient,
  CryptoTransaction,
  BlockchainNetwork,
  TransactionType,
  TransactionStatus,
} from '@prisma/client';
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { logger } from '@/utils/logger';

export interface TransactionFilters {
  walletId?: string;
  networks?: BlockchainNetwork[];
  types?: TransactionType[];
  statuses?: TransactionStatus[];
  dateFrom?: Date;
  dateTo?: Date;
  minValue?: number;
  maxValue?: number;
  search?: string;
}

export interface TransactionWithAsset extends CryptoTransaction {
  asset?: {
    id: string;
    symbol: string;
    name: string;
    logoUrl: string | null;
    network: BlockchainNetwork;
  };
}

export interface TransactionAnalytics {
  totalTransactions: number;
  totalVolumeUsd: number;
  typeDistribution: Array<{
    type: TransactionType;
    count: number;
    volumeUsd: number;
    percentage: number;
  }>;
  networkDistribution: Array<{
    network: BlockchainNetwork;
    count: number;
    volumeUsd: number;
    percentage: number;
  }>;
  dailyActivity: Array<{
    date: Date;
    count: number;
    volumeUsd: number;
  }>;
  statusDistribution: Array<{
    status: TransactionStatus;
    count: number;
    percentage: number;
  }>;
}

export class CryptoTransactionRepository extends BaseRepository<CryptoTransaction> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'cryptoTransaction');
  }

  /**
   * Find transactions with advanced filtering
   */
  async findTransactions(
    filters: TransactionFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 50 }
  ): Promise<PaginatedResult<TransactionWithAsset>> {
    const where: any = {
      ...(filters.walletId && { walletId: filters.walletId }),
      ...(filters.networks?.length && { network: { in: filters.networks } }),
      ...(filters.types?.length && { type: { in: filters.types } }),
      ...(filters.statuses?.length && { status: { in: filters.statuses } }),
      ...(filters.minValue && { valueUsd: { gte: filters.minValue } }),
      ...(filters.maxValue && { valueUsd: { lte: filters.maxValue } }),
    };

    // Date range filter
    if (filters.dateFrom || filters.dateTo) {
      where.timestamp = {};
      if (filters.dateFrom) where.timestamp.gte = filters.dateFrom;
      if (filters.dateTo) where.timestamp.lte = filters.dateTo;
    }

    // Search filter
    if (filters.search) {
      where.OR = [
        { hash: { contains: filters.search, mode: 'insensitive' } },
        { fromAddress: { contains: filters.search, mode: 'insensitive' } },
        { toAddress: { contains: filters.search, mode: 'insensitive' } },
        { asset: { symbol: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    return this.executeWithMetrics(
      'findTransactions',
      async () => {
        const { page, limit, orderBy = { timestamp: 'desc' } } = pagination;
        const skip = (page - 1) * limit;

        const [transactions, total] = await Promise.all([
          this.prisma.cryptoTransaction.findMany({
            where,
            include: {
              asset: {
                select: {
                  id: true,
                  symbol: true,
                  name: true,
                  logoUrl: true,
                  network: true,
                },
              },
            },
            orderBy,
            skip,
            take: limit,
          }),
          this.prisma.cryptoTransaction.count({ where }),
        ]);

        const pages = Math.ceil(total / limit);

        return {
          data: transactions as TransactionWithAsset[],
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
      { filters, pagination }
    );
  }

  /**
   * Get transaction analytics for a wallet
   */
  async getTransactionAnalytics(walletId: string, days = 30): Promise<TransactionAnalytics> {
    return this.executeWithMetrics(
      'getTransactionAnalytics',
      async () => {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const where = {
          walletId,
          timestamp: { gte: cutoffDate },
        };

        // Get all transactions for analysis
        const transactions = await this.prisma.cryptoTransaction.findMany({
          where,
          select: {
            type: true,
            network: true,
            status: true,
            valueUsd: true,
            timestamp: true,
          },
        });

        const totalTransactions = transactions.length;
        const totalVolumeUsd = transactions.reduce(
          (sum, tx) => sum + (tx.valueUsd?.toNumber() || 0),
          0
        );

        // Type distribution
        const typeMap = new Map<TransactionType, { count: number; volumeUsd: number }>();
        transactions.forEach((tx) => {
          const existing = typeMap.get(tx.type) || { count: 0, volumeUsd: 0 };
          typeMap.set(tx.type, {
            count: existing.count + 1,
            volumeUsd: existing.volumeUsd + (tx.valueUsd?.toNumber() || 0),
          });
        });

        const typeDistribution = Array.from(typeMap.entries())
          .map(([type, data]) => ({
            type,
            count: data.count,
            volumeUsd: data.volumeUsd,
            percentage: totalTransactions > 0 ? (data.count / totalTransactions) * 100 : 0,
          }))
          .sort((a, b) => b.count - a.count);

        // Network distribution
        const networkMap = new Map<BlockchainNetwork, { count: number; volumeUsd: number }>();
        transactions.forEach((tx) => {
          const existing = networkMap.get(tx.network) || { count: 0, volumeUsd: 0 };
          networkMap.set(tx.network, {
            count: existing.count + 1,
            volumeUsd: existing.volumeUsd + (tx.valueUsd?.toNumber() || 0),
          });
        });

        const networkDistribution = Array.from(networkMap.entries())
          .map(([network, data]) => ({
            network,
            count: data.count,
            volumeUsd: data.volumeUsd,
            percentage: totalTransactions > 0 ? (data.count / totalTransactions) * 100 : 0,
          }))
          .sort((a, b) => b.count - a.count);

        // Daily activity
        const dailyMap = new Map<string, { count: number; volumeUsd: number }>();
        transactions.forEach((tx) => {
          const dateKey = tx.timestamp.toISOString().split('T')[0];
          const existing = dailyMap.get(dateKey) || { count: 0, volumeUsd: 0 };
          dailyMap.set(dateKey, {
            count: existing.count + 1,
            volumeUsd: existing.volumeUsd + (tx.valueUsd?.toNumber() || 0),
          });
        });

        const dailyActivity = Array.from(dailyMap.entries())
          .map(([dateStr, data]) => ({
            date: new Date(dateStr),
            count: data.count,
            volumeUsd: data.volumeUsd,
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());

        // Status distribution
        const statusMap = new Map<TransactionStatus, number>();
        transactions.forEach((tx) => {
          statusMap.set(tx.status, (statusMap.get(tx.status) || 0) + 1);
        });

        const statusDistribution = Array.from(statusMap.entries())
          .map(([status, count]) => ({
            status,
            count,
            percentage: totalTransactions > 0 ? (count / totalTransactions) * 100 : 0,
          }))
          .sort((a, b) => b.count - a.count);

        return {
          totalTransactions,
          totalVolumeUsd,
          typeDistribution,
          networkDistribution,
          dailyActivity,
          statusDistribution,
        };
      },
      { walletId, days }
    );
  }

  /**
   * Bulk upsert transactions efficiently
   */
  async bulkUpsertTransactions(
    transactions: Array<{
      walletId: string;
      hash: string;
      network: BlockchainNetwork;
      type: TransactionType;
      status: TransactionStatus;
      fromAddress?: string;
      toAddress?: string;
      amount?: number;
      valueUsd?: number;
      gasUsed?: number;
      gasPrice?: number;
      timestamp: Date;
      assetId?: string;
      blockNumber?: number;
    }>
  ): Promise<number> {
    return this.executeWithMetrics(
      'bulkUpsertTransactions',
      async () => {
        let upsertedCount = 0;
        const batchSize = 50;

        // Process in batches
        for (let i = 0; i < transactions.length; i += batchSize) {
          const batch = transactions.slice(i, i + batchSize);

          await this.withTransaction(async (tx) => {
            const upsertPromises = batch.map((transaction) =>
              tx.cryptoTransaction.upsert({
                where: {
                  hash_network: {
                    hash: transaction.hash,
                    network: transaction.network,
                  },
                },
                update: {
                  status: transaction.status,
                  valueUsd: transaction.valueUsd,
                  gasUsed: transaction.gasUsed,
                  gasPrice: transaction.gasPrice,
                  updatedAt: new Date(),
                },
                create: {
                  walletId: transaction.walletId,
                  hash: transaction.hash,
                  network: transaction.network,
                  type: transaction.type,
                  status: transaction.status,
                  fromAddress: transaction.fromAddress,
                  toAddress: transaction.toAddress,
                  amount: transaction.amount,
                  valueUsd: transaction.valueUsd,
                  gasUsed: transaction.gasUsed,
                  gasPrice: transaction.gasPrice,
                  timestamp: transaction.timestamp,
                  assetId: transaction.assetId,
                  blockNumber: transaction.blockNumber,
                },
              })
            );

            await Promise.all(upsertPromises);
            upsertedCount += batch.length;
          });
        }

        logger.info('Bulk upserted transactions', {
          totalTransactions: transactions.length,
          upsertedCount,
        });

        return upsertedCount;
      },
      { transactionCount: transactions.length }
    );
  }

  /**
   * Get recent transactions for a wallet
   */
  async getRecentTransactions(walletId: string, limit = 20): Promise<TransactionWithAsset[]> {
    return this.executeWithMetrics(
      'getRecentTransactions',
      async () => {
        return this.prisma.cryptoTransaction.findMany({
          where: { walletId },
          include: {
            asset: {
              select: {
                id: true,
                symbol: true,
                name: true,
                logoUrl: true,
                network: true,
              },
            },
          },
          orderBy: { timestamp: 'desc' },
          take: limit,
        }) as Promise<TransactionWithAsset[]>;
      },
      { walletId, limit }
    );
  }

  /**
   * Find duplicate transactions (same hash on same network)
   */
  async findDuplicateTransactions(): Promise<
    Array<{
      hash: string;
      network: BlockchainNetwork;
      count: number;
      transactionIds: string[];
    }>
  > {
    return this.executeWithMetrics('findDuplicateTransactions', async () => {
      const duplicates = await this.prisma.cryptoTransaction.groupBy({
        by: ['hash', 'network'],
        having: {
          hash: {
            _count: {
              gt: 1,
            },
          },
        },
        _count: {
          hash: true,
        },
      });

      const duplicateDetails = await Promise.all(
        duplicates.map(async (duplicate) => {
          const transactions = await this.prisma.cryptoTransaction.findMany({
            where: {
              hash: duplicate.hash,
              network: duplicate.network,
            },
            select: { id: true },
          });

          return {
            hash: duplicate.hash,
            network: duplicate.network,
            count: duplicate._count.hash,
            transactionIds: transactions.map((tx) => tx.id),
          };
        })
      );

      return duplicateDetails;
    });
  }

  /**
   * Clean up old failed transactions
   */
  async cleanupFailedTransactions(daysOld = 30): Promise<number> {
    return this.executeWithMetrics(
      'cleanupFailedTransactions',
      async () => {
        const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

        const result = await this.prisma.cryptoTransaction.deleteMany({
          where: {
            status: TransactionStatus.FAILED,
            timestamp: { lt: cutoffDate },
          },
        });

        logger.info('Cleaned up old failed transactions', {
          deletedCount: result.count,
          cutoffDate,
        });

        return result.count;
      },
      { daysOld }
    );
  }

  /**
   * Get transaction volume trends
   */
  async getVolumeTransactions(
    walletId: string,
    days = 30,
    minValueUsd = 100
  ): Promise<
    Array<{
      date: Date;
      totalVolumeUsd: number;
      transactionCount: number;
      averageValueUsd: number;
    }>
  > {
    return this.executeWithMetrics(
      'getVolumeTransactions',
      async () => {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const transactions = await this.prisma.cryptoTransaction.findMany({
          where: {
            walletId,
            timestamp: { gte: cutoffDate },
            valueUsd: { gte: minValueUsd },
            status: TransactionStatus.COMPLETED,
          },
          select: {
            timestamp: true,
            valueUsd: true,
          },
          orderBy: { timestamp: 'asc' },
        });

        // Group by day
        const dailyData = new Map<string, { volumeUsd: number; count: number }>();

        transactions.forEach((tx) => {
          const dateKey = tx.timestamp.toISOString().split('T')[0];
          const existing = dailyData.get(dateKey) || { volumeUsd: 0, count: 0 };
          dailyData.set(dateKey, {
            volumeUsd: existing.volumeUsd + (tx.valueUsd?.toNumber() || 0),
            count: existing.count + 1,
          });
        });

        return Array.from(dailyData.entries())
          .map(([dateStr, data]) => ({
            date: new Date(dateStr),
            totalVolumeUsd: data.volumeUsd,
            transactionCount: data.count,
            averageValueUsd: data.count > 0 ? data.volumeUsd / data.count : 0,
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());
      },
      { walletId, days, minValueUsd }
    );
  }

  /**
   * Get pending transactions that need status updates
   */
  async getPendingTransactions(
    maxAge = 24 * 60 * 60 * 1000, // 24 hours
    limit = 100
  ): Promise<CryptoTransaction[]> {
    return this.executeWithMetrics(
      'getPendingTransactions',
      async () => {
        const cutoffDate = new Date(Date.now() - maxAge);

        return this.prisma.cryptoTransaction.findMany({
          where: {
            status: TransactionStatus.PENDING,
            timestamp: { gte: cutoffDate },
          },
          orderBy: { timestamp: 'asc' },
          take: limit,
        });
      },
      { maxAge, limit }
    );
  }

  /**
   * Update transaction status
   */
  async updateTransactionStatus(
    hash: string,
    network: BlockchainNetwork,
    status: TransactionStatus,
    blockNumber?: number,
    gasUsed?: number
  ): Promise<boolean> {
    return this.executeWithMetrics(
      'updateTransactionStatus',
      async () => {
        const result = await this.prisma.cryptoTransaction.updateMany({
          where: { hash, network },
          data: {
            status,
            blockNumber,
            gasUsed,
            updatedAt: new Date(),
          },
        });

        return result.count > 0;
      },
      { hash: hash.substring(0, 10) + '...', network, status }
    );
  }
}
