import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/environment';

declare global {
  var __prisma: PrismaClient | undefined;
}

// Enhanced Prisma configuration for optimal performance
const prismaConfig = {
  datasources: {
    db: {
      url: config.database.url,
    },
  },
  // log: [
  //   { level: 'query', emit: 'event' },
  //   { level: 'error', emit: 'event' },
  //   { level: 'warn', emit: 'event' },
  //   { level: 'info', emit: 'event' },
  // ] as Prisma.LogLevel[],
  errorFormat: 'pretty' as const,
};

// Enhanced Prisma client with performance monitoring
class EnhancedPrismaClient extends PrismaClient {
  private queryCount = 0;
  private slowQueries: Array<{ query: string; duration: number; timestamp: Date }> = [];

  constructor() {
    super(prismaConfig);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Event listeners disabled for now due to Prisma log configuration issues
    logger.info('Database event listeners initialized (basic mode)');
  }

  // Get performance metrics
  getMetrics(): {
    queryCount: number;
    slowQueriesCount: number;
    averageSlowQueryDuration: number;
    recentSlowQueries: Array<{ query: string; duration: number; timestamp: Date }>;
  } {
    const avgDuration =
      this.slowQueries.length > 0
        ? this.slowQueries.reduce((sum, q) => sum + q.duration, 0) / this.slowQueries.length
        : 0;

    return {
      queryCount: this.queryCount,
      slowQueriesCount: this.slowQueries.length,
      averageSlowQueryDuration: avgDuration,
      recentSlowQueries: this.slowQueries.slice(-10), // Last 10 slow queries
    };
  }

  // Reset metrics
  resetMetrics(): void {
    this.queryCount = 0;
    this.slowQueries = [];
    logger.info('Database metrics reset');
  }

  // Health check
  async healthCheck(): Promise<{
    healthy: boolean;
    connectionStatus: string;
    responseTime: number;
    metrics: ReturnType<EnhancedPrismaClient['getMetrics']>;
  }> {
    const startTime = Date.now();

    try {
      // Test basic connectivity
      await this.$queryRaw`SELECT 1 as test`;
      const responseTime = Date.now() - startTime;

      return {
        healthy: responseTime < 5000, // Consider healthy if response under 5s
        connectionStatus: 'connected',
        responseTime,
        metrics: this.getMetrics(),
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Database health check failed', { error });

      return {
        healthy: false,
        connectionStatus: 'disconnected',
        responseTime,
        metrics: this.getMetrics(),
      };
    }
  }

  // Enhanced transaction with retry logic
  async safeTransaction<T>(
    operation: (
      tx: Omit<
        PrismaClient,
        '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
      >
    ) => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.$transaction(operation, {
          maxWait: 30000, // 30 seconds
          timeout: 60000, // 60 seconds
        });
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (this.isRetryableError(error) && attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
          logger.warn(`Transaction failed, retrying in ${delay}ms`, {
            attempt,
            error: (error as Error).message,
          });
          await this.sleep(delay);
          continue;
        }

        // Non-retryable error or max retries reached
        break;
      }
    }

    logger.error('Transaction failed after all retries', {
      attempts: maxRetries,
      error: lastError!.message,
    });
    throw lastError!;
  }

  private isRetryableError(error: unknown): boolean {
    const retryableCodes = [
      '40001', // serialization_failure
      '40P01', // deadlock_detected
      '53300', // too_many_connections
      '08006', // connection_failure
    ];

    const errorCode =
      (error as { code?: string; meta?: { code?: string } })?.code ||
      (error as { code?: string; meta?: { code?: string } })?.meta?.code;
    return errorCode ? retryableCodes.includes(errorCode) : false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Create singleton instance
export const prisma = globalThis.__prisma || new EnhancedPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__prisma = prisma;
}

// Connection management
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully', {
      poolSize: config.database.poolSize,
      environment: config.nodeEnv,
    });

    // Run a simple query to ensure connection is working
    await prisma.$queryRaw`SELECT NOW() as current_time`;
    logger.info('Database connectivity verified');
  } catch (error) {
    logger.error('Failed to connect to database', { error });
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error('Error disconnecting from database', { error });
    throw error;
  }
}

// Connection pool monitoring
export async function getConnectionPoolStatus(): Promise<{
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  maxConnections: number;
}> {
  try {
    const result = await prisma.$queryRaw<
      Array<{
        total_connections: number;
        active_connections: number;
        idle_connections: number;
        max_connections: number;
      }>
    >`
      SELECT
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections,
        setting::int as max_connections
      FROM pg_stat_activity, pg_settings
      WHERE pg_settings.name = 'max_connections'
        AND datname = current_database()
      GROUP BY setting
    `;

    if (result.length > 0) {
      const stats = result[0];
      return {
        totalConnections: Number(stats?.total_connections || 0),
        activeConnections: Number(stats?.active_connections || 0),
        idleConnections: Number(stats?.idle_connections || 0),
        maxConnections: Number(stats?.max_connections || 0),
      };
    }

    return {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      maxConnections: 0,
    };
  } catch (error) {
    logger.error('Failed to get connection pool status', { error });
    return {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      maxConnections: 0,
    };
  }
}

// Database performance monitoring
export async function getDatabasePerformanceMetrics(): Promise<{
  slowQueries: Array<{
    query: string;
    meanExecTime: number;
    calls: number;
    totalExecTime: number;
  }>;
  tableStats: Array<{
    tableName: string;
    size: string;
    rowCount: number;
  }>;
  indexUsage: Array<{
    tableName: string;
    indexName: string;
    indexScans: number;
    tuplesFetched: number;
  }>;
}> {
  try {
    // Get slow queries (requires pg_stat_statements extension)
    const slowQueries = await prisma.$queryRaw<
      Array<{
        query: string;
        mean_exec_time: number;
        calls: number;
        total_exec_time: number;
      }>
    >`
      SELECT
        LEFT(query, 100) as query,
        mean_exec_time,
        calls,
        total_exec_time
      FROM pg_stat_statements
      WHERE mean_exec_time > 100
      ORDER BY mean_exec_time DESC
      LIMIT 10
    `.catch(() => []);

    // Get table sizes
    const tableStats = await prisma.$queryRaw<
      Array<{
        table_name: string;
        size: string;
        row_count: number;
      }>
    >`
      SELECT
        schemaname||'.'||tablename as table_name,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        COALESCE(n_tup_ins + n_tup_upd + n_tup_del, 0) as row_count
      FROM pg_tables
      LEFT JOIN pg_stat_user_tables ON pg_tables.tablename = pg_stat_user_tables.relname
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      LIMIT 10
    `;

    // Get index usage
    const indexUsage = await prisma.$queryRaw<
      Array<{
        table_name: string;
        index_name: string;
        idx_scan: number;
        idx_tup_fetch: number;
      }>
    >`
      SELECT
        schemaname||'.'||tablename as table_name,
        indexrelname as index_name,
        idx_scan,
        idx_tup_fetch
      FROM pg_stat_user_indexes
      WHERE idx_scan > 0
      ORDER BY idx_scan DESC
      LIMIT 20
    `;

    return {
      slowQueries: slowQueries.map((q) => ({
        query: q.query,
        meanExecTime: Number(q.mean_exec_time),
        calls: Number(q.calls),
        totalExecTime: Number(q.total_exec_time),
      })),
      tableStats: tableStats.map((t) => ({
        tableName: t.table_name,
        size: t.size,
        rowCount: Number(t.row_count),
      })),
      indexUsage: indexUsage.map((i) => ({
        tableName: i.table_name,
        indexName: i.index_name,
        indexScans: Number(i.idx_scan),
        tuplesFetched: Number(i.idx_tup_fetch),
      })),
    };
  } catch (error) {
    logger.error('Failed to get database performance metrics', { error });
    return {
      slowQueries: [],
      tableStats: [],
      indexUsage: [],
    };
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down database connection...');
  await disconnectDatabase();
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down database connection...');
  await disconnectDatabase();
});

export default prisma;
