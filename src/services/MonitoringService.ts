import { logger } from '@/utils/logger';
import { prisma, getConnectionPoolStatus, getDatabasePerformanceMetrics } from '@/config/database';
import { getCacheService } from '@/services/CacheService';
import { queueManager } from '@/config/queue';
import { RepositoryContainer } from '@/repositories';

export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  details?: Record<string, any>;
  timestamp: Date;
  error?: string;
}

export interface SystemHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  services: HealthCheckResult[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
  metrics: {
    uptime: number;
    memory: NodeJS.MemoryUsage;
    cpu: number;
    loadAverage: number[];
  };
}

export interface ServiceMetrics {
  timestamp: Date;
  service: string;
  metrics: Record<string, number | string>;
  tags?: Record<string, string>;
}

export class MonitoringService {
  private static instance: MonitoringService;
  private healthChecks: Map<string, () => Promise<HealthCheckResult>> = new Map();
  private metricsBuffer: ServiceMetrics[] = [];
  private readonly maxMetricsBuffer = 1000;
  private startTime = Date.now();

  private constructor() {
    this.setupDefaultHealthChecks();
    this.startMetricsCollection();
  }

  static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  private setupDefaultHealthChecks(): void {
    // Database health check
    this.healthChecks.set('database', async () => {
      const startTime = Date.now();
      try {
        const health = await (prisma as any).healthCheck();
        const poolStatus = await getConnectionPoolStatus();

        return {
          service: 'database',
          status: health.healthy ? 'healthy' : 'unhealthy',
          responseTime: Date.now() - startTime,
          details: {
            connectionStatus: health.connectionStatus,
            connectionPool: poolStatus,
            queryMetrics: health.metrics,
          },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: 'database',
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        };
      }
    });

    // Cache health check
    this.healthChecks.set('cache', async () => {
      const startTime = Date.now();
      const cacheService = getCacheService();

      if (!cacheService) {
        return {
          service: 'cache',
          status: 'degraded',
          responseTime: 0,
          details: { message: 'Cache service not available' },
          timestamp: new Date(),
        };
      }

      try {
        const health = await cacheService.healthCheck();
        const stats = cacheService.getStats();

        return {
          service: 'cache',
          status: health.healthy ? 'healthy' : 'degraded',
          responseTime: Date.now() - startTime,
          details: {
            connected: health.connected,
            responseTime: health.responseTime,
            stats,
            memoryUsage: health.memoryUsage,
          },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: 'cache',
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        };
      }
    });

    // Queue system health check
    this.healthChecks.set('queues', async () => {
      const startTime = Date.now();
      try {
        const health = await queueManager.getQueueHealth();
        const stats = await queueManager.getQueueStats();

        return {
          service: 'queues',
          status: health.healthy ? 'healthy' : 'degraded',
          responseTime: Date.now() - startTime,
          details: {
            queues: health.queues,
            stats,
          },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: 'queues',
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        };
      }
    });

    // Repository health check
    this.healthChecks.set('repositories', async () => {
      const startTime = Date.now();
      try {
        const repositories = RepositoryContainer.getInstance(prisma);
        const health = await repositories.healthCheck();

        return {
          service: 'repositories',
          status: health.healthy ? 'healthy' : 'degraded',
          responseTime: Date.now() - startTime,
          details: {
            repositories: health.repositories,
          },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: 'repositories',
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        };
      }
    });

    // External API health check (sample)
    this.healthChecks.set('external-apis', async () => {
      const startTime = Date.now();
      try {
        // This would check external APIs like Zerion, Zapper, etc.
        // For now, just a placeholder
        const checks = await Promise.allSettled([
          this.checkExternalAPI('https://api.zerion.io/v1/health'),
          // Add other API checks here
        ]);

        const allHealthy = checks.every((check) => check.status === 'fulfilled' && check.value);

        return {
          service: 'external-apis',
          status: allHealthy ? 'healthy' : 'degraded',
          responseTime: Date.now() - startTime,
          details: {
            checks: checks.map((check, index) => ({
              index,
              status: check.status,
              result: check.status === 'fulfilled' ? check.value : check.reason,
            })),
          },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: 'external-apis',
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        };
      }
    });

    // System resources health check
    this.healthChecks.set('system', async () => {
      const startTime = Date.now();
      try {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const uptime = process.uptime();
        const loadAverage = require('os').loadavg();

        // Calculate memory usage percentage
        const totalMemory = require('os').totalmem();
        const freeMemory = require('os').freemem();
        const memoryUsagePercent = ((totalMemory - freeMemory) / totalMemory) * 100;

        // Check system health based on thresholds
        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

        if (memoryUsagePercent > 90 || loadAverage[0] > require('os').cpus().length * 2) {
          status = 'unhealthy';
        } else if (memoryUsagePercent > 80 || loadAverage[0] > require('os').cpus().length) {
          status = 'degraded';
        }

        return {
          service: 'system',
          status,
          responseTime: Date.now() - startTime,
          details: {
            memory: {
              usage: memoryUsage,
              percentage: memoryUsagePercent,
              total: totalMemory,
              free: freeMemory,
            },
            cpu: {
              usage: cpuUsage,
              loadAverage,
              cores: require('os').cpus().length,
            },
            uptime,
            platform: process.platform,
            nodeVersion: process.version,
          },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: 'system',
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        };
      }
    });
  }

  private async checkExternalAPI(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(url, {
        signal: controller.signal,
        method: 'HEAD',
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Register a custom health check
   */
  registerHealthCheck(name: string, check: () => Promise<HealthCheckResult>): void {
    this.healthChecks.set(name, check);
    logger.info('Health check registered', { name });
  }

  /**
   * Remove a health check
   */
  unregisterHealthCheck(name: string): void {
    this.healthChecks.delete(name);
    logger.info('Health check unregistered', { name });
  }

  /**
   * Run all health checks
   */
  async checkHealth(): Promise<SystemHealth> {
    const timestamp = new Date();
    const checks = Array.from(this.healthChecks.entries());

    // Run all health checks in parallel with timeout
    const results = await Promise.allSettled(
      checks.map(async ([name, check]) => {
        const timeoutPromise = new Promise<HealthCheckResult>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 10000)
        );

        try {
          return await Promise.race([check(), timeoutPromise]);
        } catch (error) {
          return {
            service: name,
            status: 'unhealthy' as const,
            responseTime: 0,
            error: error instanceof Error ? error.message : String(error),
            timestamp,
          };
        }
      })
    );

    const services: HealthCheckResult[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          service: checks[index]?.[0] || 'unknown',
          status: 'unhealthy',
          responseTime: 0,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          timestamp,
        };
      }
    });

    // Calculate overall system status
    const healthy = services.filter((s) => s.status === 'healthy').length;
    const degraded = services.filter((s) => s.status === 'degraded').length;
    const unhealthy = services.filter((s) => s.status === 'unhealthy').length;

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (unhealthy > 0) {
      overallStatus = 'unhealthy';
    } else if (degraded > 0) {
      overallStatus = 'degraded';
    }

    // System metrics
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = Date.now() - this.startTime;
    const loadAverage = require('os').loadavg();

    return {
      status: overallStatus,
      timestamp,
      services,
      summary: {
        total: services.length,
        healthy,
        degraded,
        unhealthy,
      },
      metrics: {
        uptime,
        memory: memoryUsage,
        cpu: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
        loadAverage,
      },
    };
  }

  /**
   * Get health status for a specific service
   */
  async checkServiceHealth(serviceName: string): Promise<HealthCheckResult | null> {
    const check = this.healthChecks.get(serviceName);
    if (!check) {
      return null;
    }

    try {
      return await check();
    } catch (error) {
      return {
        service: serviceName,
        status: 'unhealthy',
        responseTime: 0,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Record custom metrics
   */
  recordMetric(
    service: string,
    metrics: Record<string, number | string>,
    tags?: Record<string, string>
  ): void {
    const metric: ServiceMetrics = {
      timestamp: new Date(),
      service,
      metrics,
      tags: tags || {},
    };

    this.metricsBuffer.push(metric);

    // Keep buffer size manageable
    if (this.metricsBuffer.length > this.maxMetricsBuffer) {
      this.metricsBuffer = this.metricsBuffer.slice(-this.maxMetricsBuffer);
    }

    logger.debug('Metric recorded', { service, metrics, tags });
  }

  /**
   * Get recent metrics
   */
  getMetrics(service?: string, limit = 100): ServiceMetrics[] {
    let metrics = this.metricsBuffer;

    if (service) {
      metrics = metrics.filter((m) => m.service === service);
    }

    return metrics.slice(-limit);
  }

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics(
    service: string,
    timeRangeMinutes = 60
  ): {
    service: string;
    timeRange: { start: Date; end: Date };
    aggregations: Record<
      string,
      {
        avg: number;
        min: number;
        max: number;
        count: number;
      }
    >;
  } {
    const now = new Date();
    const startTime = new Date(now.getTime() - timeRangeMinutes * 60 * 1000);

    const relevantMetrics = this.metricsBuffer.filter(
      (m) => m.service === service && m.timestamp >= startTime
    );

    const aggregations: Record<
      string,
      {
        avg: number;
        min: number;
        max: number;
        count: number;
      }
    > = {};

    // Group by metric name
    const metricGroups = new Map<string, number[]>();

    relevantMetrics.forEach((metric) => {
      Object.entries(metric.metrics).forEach(([key, value]) => {
        if (typeof value === 'number') {
          if (!metricGroups.has(key)) {
            metricGroups.set(key, []);
          }
          metricGroups.get(key)!.push(value);
        }
      });
    });

    // Calculate aggregations
    metricGroups.forEach((values, metricName) => {
      if (values.length > 0) {
        aggregations[metricName] = {
          avg: values.reduce((sum, val) => sum + val, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length,
        };
      }
    });

    return {
      service,
      timeRange: { start: startTime, end: now },
      aggregations,
    };
  }

  /**
   * Start automatic metrics collection
   */
  private startMetricsCollection(): void {
    // Collect system metrics every 30 seconds
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const loadAverage = require('os').loadavg();

      this.recordMetric('system', {
        'memory.rss': memoryUsage.rss,
        'memory.heapUsed': memoryUsage.heapUsed,
        'memory.heapTotal': memoryUsage.heapTotal,
        'memory.external': memoryUsage.external,
        'cpu.user': cpuUsage.user,
        'cpu.system': cpuUsage.system,
        'load.1m': loadAverage[0],
        'load.5m': loadAverage[1],
        'load.15m': loadAverage[2],
        uptime: Date.now() - this.startTime,
      });
    }, 30000);

    // Collect cache metrics every minute
    setInterval(async () => {
      const cacheService = getCacheService();
      if (cacheService) {
        const stats = cacheService.getStats();
        this.recordMetric('cache', {
          hits: stats.hits,
          misses: stats.misses,
          sets: stats.sets,
          deletes: stats.deletes,
          errors: stats.errors,
          hitRate: stats.hitRate,
        });
      }
    }, 60000);

    // Collect queue metrics every minute
    setInterval(async () => {
      try {
        const stats = await queueManager.getQueueStats();
        Object.entries(stats).forEach(([queueName, queueStats]) => {
          if (!queueStats.error) {
            this.recordMetric(
              'queue',
              {
                waiting: queueStats.waiting,
                active: queueStats.active,
                completed: queueStats.completed,
                failed: queueStats.failed,
                delayed: queueStats.delayed,
                avgProcessingTime: queueStats.metrics.averageProcessingTime,
              },
              { queue: queueName }
            );
          }
        });
      } catch (error) {
        logger.error('Failed to collect queue metrics', { error });
      }
    }, 60000);

    logger.info('Metrics collection started');
  }

  /**
   * Get system performance summary
   */
  async getPerformanceSummary(): Promise<{
    system: SystemHealth;
    database: any;
    cache: any;
    queues: any;
  }> {
    const [systemHealth, dbMetrics] = await Promise.all([
      this.checkHealth(),
      getDatabasePerformanceMetrics(),
    ]);

    const cacheService = getCacheService();
    const cacheStats = cacheService ? cacheService.getStats() : null;

    const queueStats = await queueManager.getQueueStats();

    return {
      system: systemHealth,
      database: dbMetrics,
      cache: cacheStats,
      queues: queueStats,
    };
  }

  /**
   * Set up alerts based on health check results
   */
  setupAlerts(config: {
    webhookUrl?: string;
    emailRecipients?: string[];
    thresholds?: {
      responseTime?: number;
      errorRate?: number;
      memoryUsage?: number;
    };
  }): void {
    const thresholds = {
      responseTime: 5000, // 5 seconds
      errorRate: 0.1, // 10%
      memoryUsage: 0.9, // 90%
      ...config.thresholds,
    };

    // Check for alerts every 5 minutes
    setInterval(
      async () => {
        try {
          const health = await this.checkHealth();

          // Check for unhealthy services
          const unhealthyServices = health.services.filter((s) => s.status === 'unhealthy');
          if (unhealthyServices.length > 0) {
            await this.sendAlert({
              type: 'service_down',
              message: `${unhealthyServices.length} service(s) are unhealthy`,
              services: unhealthyServices.map((s) => s.service),
              severity: 'high',
            });
          }

          // Check memory usage
          const memoryUsage = health.metrics.memory.heapUsed / health.metrics.memory.heapTotal;
          if (memoryUsage > thresholds.memoryUsage) {
            await this.sendAlert({
              type: 'high_memory_usage',
              message: `Memory usage is ${(memoryUsage * 100).toFixed(2)}%`,
              severity: 'medium',
            });
          }

          // Check response times
          const slowServices = health.services.filter(
            (s) => s.responseTime > thresholds.responseTime
          );
          if (slowServices.length > 0) {
            await this.sendAlert({
              type: 'slow_response',
              message: `${slowServices.length} service(s) have slow response times`,
              services: slowServices.map((s) => s.service),
              severity: 'medium',
            });
          }
        } catch (error) {
          logger.error('Alert check failed', { error });
        }
      },
      5 * 60 * 1000
    ); // 5 minutes

    logger.info('Alerts configured', { thresholds });
  }

  private async sendAlert(alert: {
    type: string;
    message: string;
    services?: string[];
    severity: 'low' | 'medium' | 'high';
  }): Promise<void> {
    logger.warn('Alert triggered', alert);

    // Here you would implement actual alerting mechanisms:
    // - Send webhook notifications
    // - Send emails
    // - Post to Slack/Discord
    // - Create tickets in monitoring systems

    // For now, just log the alert
    // In production, you'd integrate with services like:
    // - PagerDuty
    // - Slack
    // - Email services
    // - SMS providers
  }
}

// Singleton instance
export const monitoringService = MonitoringService.getInstance();
