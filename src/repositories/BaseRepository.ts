import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

export interface PaginationOptions {
  page: number;
  limit: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface QueryMetrics {
  duration: number;
  query: string;
  params?: any;
  rowCount?: number;
}

export abstract class BaseRepository<T = any> {
  protected prisma: PrismaClient;
  protected readonly modelName: string;
  private metrics: QueryMetrics[] = [];

  constructor(prisma: PrismaClient, modelName: string) {
    this.prisma = prisma;
    this.modelName = modelName;
  }

  /**
   * Execute a query with performance monitoring
   */
  protected async executeWithMetrics<R>(
    queryName: string,
    query: () => Promise<R>,
    params?: any
  ): Promise<R> {
    const startTime = Date.now();

    try {
      const result = await query();
      const duration = Date.now() - startTime;

      const metric: QueryMetrics = {
        duration,
        query: queryName,
        params,
        rowCount: Array.isArray(result) ? result.length : 1,
      };

      this.recordMetric(metric);

      if (duration > 1000) {
        logger.warn('Slow query detected', {
          repository: this.modelName,
          query: queryName,
          duration,
          params,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Query failed', {
        repository: this.modelName,
        query: queryName,
        duration,
        error: error instanceof Error ? error.message : String(error),
        params,
      });
      throw error;
    }
  }

  /**
   * Paginated find with optimizations
   */
  protected async findManyPaginated(
    options: {
      where?: any;
      include?: any;
      select?: any;
      orderBy?: any;
    } & PaginationOptions
  ): Promise<PaginatedResult<T>> {
    const { page, limit, where, include, select, orderBy } = options;
    const skip = (page - 1) * limit;

    return this.executeWithMetrics(
      'findManyPaginated',
      async () => {
        // Use Promise.all for parallel execution
        const [data, total] = await Promise.all([
          (this.prisma as any)[this.modelName].findMany({
            where,
            include,
            select,
            orderBy,
            skip,
            take: limit,
          }),
          (this.prisma as any)[this.modelName].count({ where }),
        ]);

        const pages = Math.ceil(total / limit);

        return {
          data,
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
      { page, limit, where: Object.keys(where || {}).length }
    );
  }

  /**
   * Optimized batch operations
   */
  protected async batchUpsert<CreateData, UpdateData>(
    items: Array<{
      where: any;
      create: CreateData;
      update: UpdateData;
    }>,
    batchSize = 100
  ): Promise<T[]> {
    const results: T[] = [];
    const batches = this.chunk(items, batchSize);

    for (const batch of batches) {
      const batchResult = await this.executeWithMetrics(
        'batchUpsert',
        async () => {
          return this.prisma.$transaction(
            batch.map(({ where, create, update }) =>
              (this.prisma as any)[this.modelName].upsert({
                where,
                create,
                update,
              })
            )
          );
        },
        { batchSize: batch.length }
      );

      results.push(...batchResult);
    }

    return results;
  }

  /**
   * Optimized bulk create with conflict handling
   */
  protected async bulkCreate(
    data: any[],
    options: {
      skipDuplicates?: boolean;
      batchSize?: number;
    } = {}
  ): Promise<number> {
    const { skipDuplicates = true, batchSize = 100 } = options;
    const batches = this.chunk(data, batchSize);
    let totalCreated = 0;

    for (const batch of batches) {
      const result = await this.executeWithMetrics(
        'bulkCreate',
        async () => {
          return (this.prisma as any)[this.modelName].createMany({
            data: batch,
            skipDuplicates,
          });
        },
        { batchSize: batch.length }
      );

      totalCreated += result.count;
    }

    return totalCreated;
  }

  /**
   * Find with intelligent caching
   */
  protected async findWithCache<R>(
    cacheKey: string,
    finder: () => Promise<R>,
    ttl = 300 // 5 minutes default
  ): Promise<R> {
    // This would be implemented with Redis in a real scenario
    // For now, just execute the finder
    return this.executeWithMetrics('findWithCache', finder, { cacheKey, ttl });
  }

  /**
   * Transaction wrapper with retry logic
   */
  protected async withTransaction<R>(
    operation: (tx: Omit<PrismaClient, '$on' | '$connect' | '$disconnect' | '$use' | '$transaction' | '$extends'>) => Promise<R>,
    maxRetries = 3
  ): Promise<R> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeWithMetrics(
          'transaction',
          async () => {
            return this.prisma.$transaction(operation);
          },
          { attempt, maxRetries }
        );
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          break;
        }

        // Check if error is retryable (deadlock, serialization failure, etc.)
        if (this.isRetryableError(error)) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await this.sleep(delay);
          continue;
        } else {
          // Non-retryable error, fail immediately
          break;
        }
      }
    }

    throw lastError!;
  }

  /**
   * Health check for repository
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    averageQueryTime: number;
    slowQueries: number;
    errorRate: number;
  }> {
    const recentMetrics = this.metrics.slice(-100); // Last 100 queries
    const totalQueries = recentMetrics.length;

    if (totalQueries === 0) {
      return {
        healthy: true,
        averageQueryTime: 0,
        slowQueries: 0,
        errorRate: 0,
      };
    }

    const averageQueryTime = recentMetrics.reduce((sum, m) => sum + m.duration, 0) / totalQueries;
    const slowQueries = recentMetrics.filter((m) => m.duration > 1000).length;

    return {
      healthy: averageQueryTime < 500 && slowQueries < 5,
      averageQueryTime,
      slowQueries,
      errorRate: 0, // Would track errors in real implementation
    };
  }

  /**
   * Utility methods
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private recordMetric(metric: QueryMetrics): void {
    this.metrics.push(metric);

    // Keep only last 1000 metrics to prevent memory leaks
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }
  }

  private isRetryableError(error: any): boolean {
    // PostgreSQL error codes that are retryable
    const retryableCodes = [
      '40001', // serialization_failure
      '40P01', // deadlock_detected
      '53300', // too_many_connections
      '08006', // connection_failure
    ];

    const code = error?.code || error?.meta?.code;
    return retryableCodes.includes(code);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get query performance metrics
   */
  getMetrics(): QueryMetrics[] {
    return [...this.metrics];
  }

  /**
   * Clear metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }
}
