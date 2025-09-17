/**
 * DeFiCacheService - Caching service for DeFi position performance optimization
 */
import Redis from 'ioredis';
import { logger } from '@/utils/logger';
import { DeFiPosition } from '@prisma/client';
// DeFiAnalytics type - using any for now since this service is not actively used
type DeFiAnalytics = any;

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
}

export class DeFiCacheService {
  private redis: Redis | null = null;
  private defaultTTL: number = 300; // 5 minutes default
  private keyPrefix: string = 'defi:';

  constructor() {
    this.initializeRedis();
  }

  private initializeRedis() {
    const redisUrl = process.env['REDIS_URL'];

    if (!redisUrl) {
      logger.warn('REDIS_URL not configured - DeFi caching will be disabled');
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      this.redis.on('connect', () => {
        logger.info('DeFi cache service connected to Redis');
      });

      this.redis.on('error', (error) => {
        logger.error('DeFi cache Redis error:', error);
        // Don't throw - continue without cache
      });

      this.redis.on('close', () => {
        logger.warn('DeFi cache Redis connection closed');
      });
    } catch (error) {
      logger.error('Failed to initialize DeFi cache service:', error);
      this.redis = null;
    }
  }

  // ===============================
  // POSITION CACHING
  // ===============================

  /**
   * Cache DeFi positions for a wallet
   */
  async cachePositions(
    walletId: string,
    positions: DeFiPosition[],
    options?: CacheOptions
  ): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.getKey(`positions:${walletId}`, options?.prefix);
      const ttl = options?.ttl || this.defaultTTL;

      await this.redis.setex(key, ttl, JSON.stringify(positions));

      logger.debug('DeFi positions cached', {
        walletId,
        positionCount: positions.length,
        ttl,
        key,
      });
    } catch (error) {
      logger.warn('Failed to cache DeFi positions:', error);
      // Don't throw - continue without cache
    }
  }

  /**
   * Get cached DeFi positions for a wallet
   */
  async getCachedPositions(
    walletId: string,
    options?: CacheOptions
  ): Promise<DeFiPosition[] | null> {
    if (!this.redis) return null;

    try {
      const key = this.getKey(`positions:${walletId}`, options?.prefix);
      const cached = await this.redis.get(key);

      if (!cached) return null;

      const positions = JSON.parse(cached) as DeFiPosition[];

      logger.debug('DeFi positions cache hit', {
        walletId,
        positionCount: positions.length,
        key,
      });

      return positions;
    } catch (error) {
      logger.warn('Failed to get cached DeFi positions:', error);
      return null;
    }
  }

  // ===============================
  // ANALYTICS CACHING
  // ===============================

  /**
   * Cache DeFi analytics for a wallet
   */
  async cacheAnalytics(
    walletId: string,
    analytics: DeFiAnalytics,
    options?: CacheOptions
  ): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.getKey(`analytics:${walletId}`, options?.prefix);
      const ttl = options?.ttl || this.defaultTTL * 2; // Longer TTL for analytics

      await this.redis.setex(key, ttl, JSON.stringify(analytics));

      logger.debug('DeFi analytics cached', {
        walletId,
        totalValueUsd: analytics.summary.totalValueUsd,
        ttl,
        key,
      });
    } catch (error) {
      logger.warn('Failed to cache DeFi analytics:', error);
      // Don't throw - continue without cache
    }
  }

  /**
   * Get cached DeFi analytics for a wallet
   */
  async getCachedAnalytics(
    walletId: string,
    options?: CacheOptions
  ): Promise<DeFiAnalytics | null> {
    if (!this.redis) return null;

    try {
      const key = this.getKey(`analytics:${walletId}`, options?.prefix);
      const cached = await this.redis.get(key);

      if (!cached) return null;

      const analytics = JSON.parse(cached) as DeFiAnalytics;

      logger.debug('DeFi analytics cache hit', {
        walletId,
        totalValueUsd: analytics.summary.totalValueUsd,
        key,
      });

      return analytics;
    } catch (error) {
      logger.warn('Failed to get cached DeFi analytics:', error);
      return null;
    }
  }

  // ===============================
  // PROTOCOL DATA CACHING
  // ===============================

  /**
   * Cache protocol metrics (like APY, TVL)
   */
  async cacheProtocolMetrics(
    protocolName: string,
    network: string,
    metrics: {
      apy?: number;
      tvl?: number;
      totalUsers?: number;
      [key: string]: any;
    },
    options?: CacheOptions
  ): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.getKey(`protocol:${protocolName}:${network}`, options?.prefix);
      const ttl = options?.ttl || this.defaultTTL * 4; // Longer TTL for protocol data

      await this.redis.setex(key, ttl, JSON.stringify(metrics));

      logger.debug('Protocol metrics cached', {
        protocolName,
        network,
        metrics: Object.keys(metrics),
        ttl,
        key,
      });
    } catch (error) {
      logger.warn('Failed to cache protocol metrics:', error);
      // Don't throw - continue without cache
    }
  }

  /**
   * Get cached protocol metrics
   */
  async getCachedProtocolMetrics(
    protocolName: string,
    network: string,
    options?: CacheOptions
  ): Promise<any | null> {
    if (!this.redis) return null;

    try {
      const key = this.getKey(`protocol:${protocolName}:${network}`, options?.prefix);
      const cached = await this.redis.get(key);

      if (!cached) return null;

      const metrics = JSON.parse(cached);

      logger.debug('Protocol metrics cache hit', {
        protocolName,
        network,
        key,
      });

      return metrics;
    } catch (error) {
      logger.warn('Failed to get cached protocol metrics:', error);
      return null;
    }
  }

  // ===============================
  // ZAPPER API RESPONSE CACHING
  // ===============================

  /**
   * Cache Zapper API response
   */
  async cacheZapperResponse(
    walletAddress: string,
    network: string,
    response: any,
    options?: CacheOptions
  ): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.getKey(`zapper:${walletAddress}:${network}`, options?.prefix);
      const ttl = options?.ttl || this.defaultTTL / 2; // Shorter TTL for API responses

      await this.redis.setex(key, ttl, JSON.stringify(response));

      logger.debug('Zapper response cached', {
        walletAddress,
        network,
        ttl,
        key,
      });
    } catch (error) {
      logger.warn('Failed to cache Zapper response:', error);
      // Don't throw - continue without cache
    }
  }

  /**
   * Get cached Zapper API response
   */
  async getCachedZapperResponse(
    walletAddress: string,
    network: string,
    options?: CacheOptions
  ): Promise<any | null> {
    if (!this.redis) return null;

    try {
      const key = this.getKey(`zapper:${walletAddress}:${network}`, options?.prefix);
      const cached = await this.redis.get(key);

      if (!cached) return null;

      const response = JSON.parse(cached);

      logger.debug('Zapper response cache hit', {
        walletAddress,
        network,
        key,
      });

      return response;
    } catch (error) {
      logger.warn('Failed to get cached Zapper response:', error);
      return null;
    }
  }

  // ===============================
  // CACHE MANAGEMENT
  // ===============================

  /**
   * Clear all DeFi cache for a wallet
   */
  async clearWalletCache(walletId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const pattern = this.getKey(`*${walletId}*`);
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info('Cleared DeFi cache for wallet', {
          walletId,
          keysCleared: keys.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to clear wallet cache:', error);
      // Don't throw - continue without cache
    }
  }

  /**
   * Clear protocol cache
   */
  async clearProtocolCache(protocolName: string): Promise<void> {
    if (!this.redis) return;

    try {
      const pattern = this.getKey(`protocol:${protocolName}:*`);
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info('Cleared protocol cache', {
          protocolName,
          keysCleared: keys.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to clear protocol cache:', error);
      // Don't throw - continue without cache
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    connected: boolean;
    keyCount?: number;
    memoryUsage?: string;
    hitRate?: number;
  }> {
    if (!this.redis) {
      return { connected: false };
    }

    try {
      const info = await this.redis.info('memory');
      const keyCount = await this.redis.dbsize();

      // Parse memory info
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1] : undefined;

      const stats: any = {
        connected: true,
        keyCount,
        hitRate: 0, // Would need to implement hit/miss tracking
      };

      if (memoryUsage) {
        stats.memoryUsage = memoryUsage;
      }

      return stats;
    } catch (error) {
      logger.warn('Failed to get cache stats:', error);
      return { connected: false };
    }
  }

  /**
   * Check if caching is available
   */
  isAvailable(): boolean {
    return this.redis !== null;
  }

  // ===============================
  // PRIVATE HELPERS
  // ===============================

  private getKey(key: string, prefix?: string): string {
    const finalPrefix = prefix || this.keyPrefix;
    return `${finalPrefix}${key}`;
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
        logger.info('DeFi cache service Redis connection closed');
      } catch (error) {
        logger.warn('Error closing DeFi cache Redis connection:', error);
      }
    }
  }
}

// Export singleton instance
export const defiCacheService = new DeFiCacheService();
