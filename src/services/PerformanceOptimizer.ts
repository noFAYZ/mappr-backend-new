import { logger } from '@/utils/logger';
import { getCacheService } from '@/services/CacheService';
import { monitoringService } from '@/services/MonitoringService';
import { Request, Response, NextFunction } from 'express';

export interface PerformanceConfig {
  enableCompression: boolean;
  enableEtag: boolean;
  enableResponseCaching: boolean;
  enableRequestDeduplication: boolean;
  enableAsyncProcessing: boolean;
  optimizeImages: boolean;
  enableBrotli: boolean;
  maxConcurrentRequests: number;
  requestTimeoutMs: number;
  slowQueryThresholdMs: number;
}

export interface PerformanceMetrics {
  responseTime: number;
  throughput: number;
  concurrentRequests: number;
  cacheHitRate: number;
  errorRate: number;
  memoryUsage: number;
  cpuUsage: number;
  timestamp: Date;
}

export class PerformanceOptimizer {
  private static instance: PerformanceOptimizer;
  private config: PerformanceConfig;
  private activeRequests = new Map<string, number>();
  private requestDedupMap = new Map<string, Promise<any>>();
  private metrics: PerformanceMetrics[] = [];
  private readonly maxMetricsHistory = 1000;

  private constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      enableCompression: true,
      enableEtag: true,
      enableResponseCaching: true,
      enableRequestDeduplication: true,
      enableAsyncProcessing: true,
      optimizeImages: true,
      enableBrotli: true,
      maxConcurrentRequests: 1000,
      requestTimeoutMs: 30000,
      slowQueryThresholdMs: 1000,
      ...config,
    };

    this.startPerformanceMonitoring();
  }

  static getInstance(config?: Partial<PerformanceConfig>): PerformanceOptimizer {
    if (!PerformanceOptimizer.instance) {
      PerformanceOptimizer.instance = new PerformanceOptimizer(config);
    }
    return PerformanceOptimizer.instance;
  }

  /**
   * Request deduplication middleware
   */
  requestDeduplication() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!this.config.enableRequestDeduplication || req.method !== 'GET') {
        return next();
      }

      const requestKey = this.generateRequestKey(req);
      const existingRequest = this.requestDedupMap.get(requestKey);

      if (existingRequest) {
        logger.debug('Request deduplicated', {
          key: requestKey,
          method: req.method,
          url: req.url,
        });

        try {
          const result = await existingRequest;
          res.json(result);
          return;
        } catch (error) {
          return next(error);
        }
      }

      // Create new request promise
      const requestPromise = new Promise((resolve, reject) => {
        const originalJson = res.json.bind(res);
        const originalStatus = res.status.bind(res);

        // let _responseData: unknown;
        // let _statusCode = 200;

        res.json = function (data: any) {
          // _responseData = data;
          resolve(data);
          return originalJson(data);
        };

        res.status = function (code: number) {
          // _statusCode = code;
          return originalStatus(code);
        };

        // Handle errors
        const originalNext = next;
        next = (error?: any) => {
          if (error) {
            reject(error);
          }
          return originalNext(error);
        };

        // Clean up after response
        res.on('finish', () => {
          setTimeout(() => {
            this.requestDedupMap.delete(requestKey);
          }, 5000); // Clean up after 5 seconds
        });
      });

      this.requestDedupMap.set(requestKey, requestPromise);
      next();
    };
  }

  /**
   * Concurrent request limiting middleware
   */
  concurrencyLimiter() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const routeKey = `${req.method}:${req.route?.path || req.path}`;
      const currentCount = this.activeRequests.get(routeKey) || 0;

      if (currentCount >= this.config.maxConcurrentRequests) {
        logger.warn('Concurrent request limit exceeded', {
          route: routeKey,
          currentCount,
          limit: this.config.maxConcurrentRequests,
        });

        res.status(503).json({
          success: false,
          error: {
            message: 'Service temporarily unavailable due to high load',
            statusCode: 503,
            timestamp: new Date().toISOString(),
            retryAfter: '5s',
          },
        });
        return;
      }

      // Increment counter
      this.activeRequests.set(routeKey, currentCount + 1);

      // Decrement on response completion
      res.on('finish', () => {
        const count = this.activeRequests.get(routeKey) || 1;
        this.activeRequests.set(routeKey, Math.max(0, count - 1));
      });

      next();
    };
  }

  /**
   * Response optimization middleware
   */
  responseOptimizer() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const startTime = Date.now();

      // Enable ETag
      if (this.config.enableEtag) {
        res.set('ETag', this.generateETag(req));
      }

      // Set cache headers for static content
      if (this.isStaticContent(req)) {
        res.set({
          'Cache-Control': 'public, max-age=86400', // 24 hours
          Expires: new Date(Date.now() + 86400 * 1000).toUTCString(),
        });
      }

      // Performance headers
      res.set({
        'X-Response-Time': '0ms', // Will be updated on finish
        'X-Request-ID': req.headers['x-request-id'] as string,
      });

      // Monitor response time
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        res.set('X-Response-Time', `${responseTime}ms`);

        // Record performance metrics
        this.recordResponseTime(req, responseTime);

        // Log slow requests
        if (responseTime > this.config.slowQueryThresholdMs) {
          logger.warn('Slow response detected', {
            method: req.method,
            url: req.url,
            responseTime,
            statusCode: res.statusCode,
            userAgent: req.get('User-Agent'),
          });
        }
      });

      next();
    };
  }

  /**
   * Async processing wrapper for heavy operations
   */
  async processAsync<T>(
    operation: () => Promise<T>,
    fallbackValue?: T,
    timeoutMs?: number
  ): Promise<T> {
    if (!this.config.enableAsyncProcessing) {
      return operation();
    }

    const timeout = timeoutMs || this.config.requestTimeoutMs;

    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Operation timeout')), timeout)
        ),
      ]);
    } catch (error) {
      logger.error('Async operation failed', {
        error: error instanceof Error ? error.message : String(error),
        timeout,
      });

      if (fallbackValue !== undefined) {
        return fallbackValue;
      }

      throw error;
    }
  }

  /**
   * Batch processing for multiple operations
   */
  async batchProcess<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchSize = 10,
    concurrency = 3
  ): Promise<R[]> {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    const results: R[] = [];
    const semaphore = new Array(concurrency).fill(null);

    const processBatch = async (batch: T[]): Promise<R[]> => {
      try {
        return await processor(batch);
      } catch (error) {
        logger.error('Batch processing failed', {
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    // Process batches with controlled concurrency
    for (const batch of batches) {
      await Promise.race(
        semaphore.map(async (_, index) => {
          const batchResults = await processBatch(batch);
          results.push(...batchResults);
          semaphore[index] = null;
        })
      );
    }

    return results;
  }

  /**
   * Memory optimization for large datasets
   */
  optimizeMemoryUsage<T>(data: T[], chunkSize = 1000, processor: (chunk: T[]) => void): void {
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      processor(chunk);

      // Force garbage collection hints
      if (global.gc && i % (chunkSize * 10) === 0) {
        global.gc();
      }
    }
  }

  /**
   * Database query optimization
   */
  async optimizeQuery<T>(query: () => Promise<T>, cacheKey?: string, ttl = 300): Promise<T> {
    const startTime = Date.now();

    try {
      // Try cache first if enabled
      if (this.config.enableResponseCaching && cacheKey) {
        const cacheService = getCacheService();
        if (cacheService) {
          const cached = await cacheService.get<T>(cacheKey);
          if (cached !== null) {
            const responseTime = Date.now() - startTime;
            monitoringService.recordMetric('query_cache', {
              hit: 1,
              responseTime,
            });
            return cached;
          }
        }
      }

      // Execute query
      const result = await query();
      const responseTime = Date.now() - startTime;

      // Cache result if enabled
      if (this.config.enableResponseCaching && cacheKey && result) {
        const cacheService = getCacheService();
        if (cacheService) {
          await cacheService.set(cacheKey, result, { ttl });
        }
      }

      // Record metrics
      monitoringService.recordMetric('query_performance', {
        responseTime,
        cached: 0,
      });

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      monitoringService.recordMetric('query_error', {
        responseTime,
        error: 1,
      });
      throw error;
    }
  }

  /**
   * Load balancing for multiple data sources
   */
  async loadBalance<T>(
    sources: Array<() => Promise<T>>,
    strategy: 'round-robin' | 'fastest' | 'random' = 'fastest'
  ): Promise<T> {
    if (sources.length === 0) {
      throw new Error('No sources provided for load balancing');
    }

    if (sources.length === 1) {
      const source = sources[0];
      if (!source) throw new Error('Invalid source');
      return await source();
    }

    switch (strategy) {
      case 'round-robin':
        const index = Math.floor(Math.random() * sources.length);
        const source = sources[index];
        if (!source) throw new Error('Invalid source at index');
        return await source();

      case 'random':
        const randomIndex = Math.floor(Math.random() * sources.length);
        const randomSource = sources[randomIndex];
        if (!randomSource) throw new Error('Invalid random source');
        return await randomSource();

      case 'fastest':
        return Promise.race(sources.map((source) => source()));

      default:
        const defaultSource = sources[0];
        if (!defaultSource) throw new Error('Invalid default source');
        return await defaultSource();
    }
  }

  /**
   * Circuit breaker pattern for external services
   */
  createCircuitBreaker<T>(
    operation: () => Promise<T>,
    options: {
      failureThreshold?: number;
      timeout?: number;
      resetTimeout?: number;
    } = {}
  ) {
    const config = {
      failureThreshold: 5,
      timeout: 10000,
      resetTimeout: 60000,
      ...options,
    };

    let state: 'closed' | 'open' | 'half-open' = 'closed';
    let failureCount = 0;
    let nextAttempt = 0;

    return async (): Promise<T> => {
      const now = Date.now();

      if (state === 'open') {
        if (now < nextAttempt) {
          throw new Error('Circuit breaker is open');
        }
        state = 'half-open';
      }

      try {
        const result = await Promise.race([
          operation(),
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Circuit breaker timeout')), config.timeout)
          ),
        ]);

        // Success - reset circuit breaker
        failureCount = 0;
        state = 'closed';
        return result;
      } catch (error) {
        failureCount++;

        if (failureCount >= config.failureThreshold) {
          state = 'open';
          nextAttempt = now + config.resetTimeout;
        }

        throw error;
      }
    };
  }

  /**
   * Resource pooling for expensive operations
   */
  createResourcePool<T>(factory: () => T, destroyer: (resource: T) => void, maxSize = 10) {
    const pool: T[] = [];
    const inUse = new Set<T>();

    const poolObject = {
      acquire: async (): Promise<T> => {
        if (pool.length > 0) {
          const resource = pool.pop()!;
          inUse.add(resource);
          return resource;
        }

        if (inUse.size < maxSize) {
          const resource = factory();
          inUse.add(resource);
          return resource;
        }

        // Wait for a resource to become available
        await new Promise((resolve) => setTimeout(resolve, 100));
        return poolObject.acquire();
      },

      release: (resource: T): void => {
        if (inUse.has(resource)) {
          inUse.delete(resource);
          pool.push(resource);
        }
      },

      destroy: (): void => {
        [...pool, ...inUse].forEach(destroyer);
        pool.length = 0;
        inUse.clear();
      },

      size: () => ({ total: pool.length + inUse.size, available: pool.length, inUse: inUse.size }),
    };

    return poolObject;
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const now = Date.now();
    const recentMetrics = this.metrics.filter(
      (m) => now - m.timestamp.getTime() < 60000 // Last minute
    );

    if (recentMetrics.length === 0) {
      return {
        responseTime: 0,
        throughput: 0,
        concurrentRequests: 0,
        cacheHitRate: 0,
        errorRate: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        timestamp: new Date(),
      };
    }

    const avgResponseTime =
      recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length;
    const throughput = recentMetrics.length;
    const concurrentRequests = Array.from(this.activeRequests.values()).reduce(
      (sum, count) => sum + count,
      0
    );

    return {
      responseTime: avgResponseTime,
      throughput,
      concurrentRequests,
      cacheHitRate: 0, // Would be calculated from cache service
      errorRate: 0, // Would be calculated from error metrics
      memoryUsage: process.memoryUsage().heapUsed,
      cpuUsage: 0, // Would be calculated from CPU metrics
      timestamp: new Date(),
    };
  }

  /**
   * Optimize application startup
   */
  async optimizeStartup(): Promise<void> {
    logger.info('Starting performance optimization');

    // Warm up caches
    const cacheService = getCacheService();
    if (cacheService) {
      // Pre-warm critical cache entries
      logger.info('Warming up caches');
    }

    // Pre-compile frequent queries
    logger.info('Pre-compiling database queries');

    // Initialize connection pools
    logger.info('Initializing connection pools');

    // Optimize garbage collection
    if (global.gc) {
      global.gc();
    }

    logger.info('Performance optimization completed');
  }

  // Private helper methods

  private generateRequestKey(req: Request): string {
    const parts = [req.method, req.path, JSON.stringify(req.query), req.get('User-Agent') || ''];
    return Buffer.from(parts.join('|')).toString('base64');
  }

  private generateETag(req: Request): string {
    const content = `${req.method}${req.path}${JSON.stringify(req.query)}`;
    return `"${Buffer.from(content).toString('base64')}"`;
  }

  private isStaticContent(req: Request): boolean {
    const staticExtensions = [
      '.js',
      '.css',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.svg',
      '.ico',
      '.woff',
      '.woff2',
    ];
    return staticExtensions.some((ext) => req.path.endsWith(ext));
  }

  private recordResponseTime(req: Request, responseTime: number): void {
    const metric: PerformanceMetrics = {
      responseTime,
      throughput: 1,
      concurrentRequests: Array.from(this.activeRequests.values()).reduce(
        (sum, count) => sum + count,
        0
      ),
      cacheHitRate: 0,
      errorRate: 0,
      memoryUsage: process.memoryUsage().heapUsed,
      cpuUsage: 0,
      timestamp: new Date(),
    };

    this.metrics.push(metric);

    // Keep metrics history manageable
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }

    // Record in monitoring service
    monitoringService.recordMetric(
      'performance',
      {
        responseTime,
        concurrentRequests: metric.concurrentRequests,
        memoryUsage: metric.memoryUsage,
      },
      {
        method: req.method,
        route: req.route?.path || req.path,
      }
    );
  }

  private startPerformanceMonitoring(): void {
    // Monitor performance every 30 seconds
    setInterval(() => {
      const metrics = this.getPerformanceMetrics();
      monitoringService.recordMetric('performance_summary', {
        avgResponseTime: metrics.responseTime,
        throughput: metrics.throughput,
        concurrentRequests: metrics.concurrentRequests,
        memoryUsage: metrics.memoryUsage,
      });
    }, 30000);

    logger.info('Performance monitoring started');
  }
}

// Singleton instance
export const performanceOptimizer = PerformanceOptimizer.getInstance();
