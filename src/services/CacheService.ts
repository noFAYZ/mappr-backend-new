import Redis from 'ioredis';
import { logger } from '@/utils/logger';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
  compress?: boolean;
  tags?: string[];
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  hitRate: number;
}

export class CacheService {
  private redis: Redis | null = null;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    hitRate: 0,
  };
  private defaultTTL = 300; // 5 minutes
  private keyPrefix = 'mappr:';

  constructor(redisUrl?: string) {
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,
          connectTimeout: 10000,
          lazyConnect: true,
          // Connection pooling for better performance
          family: 4,
          keepAlive: 30000,
          commandTimeout: 5000,
        });

        this.redis.on('error', (error) => {
          logger.error('Redis connection error:', error);
          this.stats.errors++;
        });

        this.redis.on('connect', () => {
          logger.info('Redis connected successfully');
        });

        logger.info('Cache service initialized with Redis');
      } catch (error) {
        logger.error('Failed to initialize Redis cache:', error);
        this.redis = null;
      }
    } else {
      logger.warn('Cache service initialized without Redis - caching disabled');
    }
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    if (!this.redis) {
      this.stats.misses++;
      return null;
    }

    try {
      const fullKey = this.buildKey(key, options.prefix);
      const cached = await this.redis.get(fullKey);

      if (cached === null) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      this.updateHitRate();

      let parsed: T;
      try {
        parsed = JSON.parse(cached);
      } catch {
        // If parsing fails, return as string
        parsed = cached as unknown as T;
      }

      logger.debug('Cache hit', { key: fullKey });
      return parsed;
    } catch (error) {
      logger.error('Cache get error:', { key, error });
      this.stats.errors++;
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      const fullKey = this.buildKey(key, options.prefix);
      const ttl = options.ttl || this.defaultTTL;

      let serialized: string;
      if (typeof value === 'string') {
        serialized = value;
      } else {
        serialized = JSON.stringify(value);
      }

      // Use compression for large objects if enabled
      if (options.compress && serialized.length > 1000) {
        // Would implement compression here (e.g., with zlib)
      }

      await this.redis.setex(fullKey, ttl, serialized);

      // Set tags for cache invalidation if provided
      if (options.tags?.length) {
        await this.setTags(fullKey, options.tags, ttl);
      }

      this.stats.sets++;
      logger.debug('Cache set', { key: fullKey, ttl, size: serialized.length });
      return true;
    } catch (error) {
      logger.error('Cache set error:', { key, error });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Delete from cache
   */
  async delete(key: string, prefix?: string): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      const fullKey = this.buildKey(key, prefix);
      const result = await this.redis.del(fullKey);

      this.stats.deletes++;
      logger.debug('Cache delete', { key: fullKey, deleted: result > 0 });
      return result > 0;
    } catch (error) {
      logger.error('Cache delete error:', { key, error });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deletePattern(pattern: string, prefix?: string): Promise<number> {
    if (!this.redis) {
      return 0;
    }

    try {
      const fullPattern = this.buildKey(pattern, prefix);
      const keys = await this.redis.keys(fullPattern);

      if (keys.length === 0) {
        return 0;
      }

      const result = await this.redis.del(...keys);
      this.stats.deletes += result;

      logger.debug('Cache pattern delete', {
        pattern: fullPattern,
        keysFound: keys.length,
        deleted: result,
      });

      return result;
    } catch (error) {
      logger.error('Cache pattern delete error:', { pattern, error });
      this.stats.errors++;
      return 0;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    if (!this.redis || tags.length === 0) {
      return 0;
    }

    try {
      let totalDeleted = 0;

      for (const tag of tags) {
        const tagKey = `${this.keyPrefix}tags:${tag}`;
        const keys = await this.redis.smembers(tagKey);

        if (keys.length > 0) {
          const deleted = await this.redis.del(...keys);
          totalDeleted += deleted;

          // Clean up the tag set
          await this.redis.del(tagKey);
        }
      }

      this.stats.deletes += totalDeleted;
      logger.debug('Cache tag invalidation', { tags, deleted: totalDeleted });

      return totalDeleted;
    } catch (error) {
      logger.error('Cache tag invalidation error:', { tags, error });
      this.stats.errors++;
      return 0;
    }
  }

  /**
   * Get or set pattern (cache-aside)
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }

    // Fetch from source
    const value = await fetcher();

    // Set in cache (don't await to avoid blocking)
    this.set(key, value, options).catch((error) => {
      logger.error('Background cache set failed:', { key, error });
    });

    return value;
  }

  /**
   * Increment counter
   */
  async increment(key: string, amount = 1, ttl?: number): Promise<number> {
    if (!this.redis) {
      return amount;
    }

    try {
      const fullKey = this.buildKey(key);
      const result = await this.redis.incrby(fullKey, amount);

      if (ttl && result === amount) {
        // Set TTL only if this is a new key
        await this.redis.expire(fullKey, ttl);
      }

      return result;
    } catch (error) {
      logger.error('Cache increment error:', { key, amount, error });
      this.stats.errors++;
      return amount;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string, prefix?: string): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      const fullKey = this.buildKey(key, prefix);
      const result = await this.redis.exists(fullKey);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error:', { key, error });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Set TTL for existing key
   */
  async expire(key: string, ttl: number, prefix?: string): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      const fullKey = this.buildKey(key, prefix);
      const result = await this.redis.expire(fullKey, ttl);
      return result === 1;
    } catch (error) {
      logger.error('Cache expire error:', { key, ttl, error });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Flush all cache
   */
  async flush(): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      await this.redis.flushdb();
      logger.warn('Cache flushed completely');
      return true;
    } catch (error) {
      logger.error('Cache flush error:', error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      hitRate: 0,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    connected: boolean;
    responseTime: number;
    memoryUsage?: any;
  }> {
    if (!this.redis) {
      return {
        healthy: false,
        connected: false,
        responseTime: 0,
      };
    }

    const startTime = Date.now();

    try {
      const [pingResult, memoryInfo] = await Promise.all([
        this.redis.ping(),
        this.redis.memory('USAGE', 'test-key').catch(() => null),
      ]);

      const responseTime = Date.now() - startTime;
      const connected = pingResult === 'PONG';

      return {
        healthy: connected && responseTime < 100,
        connected,
        responseTime,
        memoryUsage: memoryInfo,
      };
    } catch (error) {
      logger.error('Cache health check failed:', error);
      return {
        healthy: false,
        connected: false,
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      logger.info('Cache service closed');
    }
  }

  // Private methods

  private buildKey(key: string, prefix?: string): string {
    const effectivePrefix = prefix || this.keyPrefix;
    return `${effectivePrefix}${key}`;
  }

  private async setTags(key: string, tags: string[], ttl: number): Promise<void> {
    if (!this.redis) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const tag of tags) {
        const tagKey = `${this.keyPrefix}tags:${tag}`;
        pipeline.sadd(tagKey, key);
        pipeline.expire(tagKey, ttl + 60); // Tag lives slightly longer than content
      }

      await pipeline.exec();
    } catch (error) {
      logger.error('Failed to set cache tags:', { key, tags, error });
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}

// Singleton instance
let cacheService: CacheService | null = null;

export function createCacheService(redisUrl?: string): CacheService {
  if (!cacheService) {
    cacheService = new CacheService(redisUrl);
  }
  return cacheService;
}

export function getCacheService(): CacheService | null {
  return cacheService;
}

// Initialize cache service
const redisUrl = process.env['REDIS_URL'];
export const cache = createCacheService(redisUrl);
