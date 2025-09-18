import { Queue, Worker, QueueOptions, ConnectionOptions, Job } from 'bullmq';
import { logger } from '@/utils/logger';

// Redis connection configuration
const getConnectionConfig = (): ConnectionOptions | null => {
  // Only use Redis URL from environment - no fallback to localhost
  const redisUrl = process.env['REDIS_URL'];
  const redisHost = process.env['REDIS_HOST'];
  const redisPort = process.env['REDIS_PORT'];
  const redisPassword = process.env['REDIS_PASSWORD'];

  if (redisHost && redisPort) {
    logger.warn('REDIS_HOST and REDIS_PORT are deprecated - please use REDIS_URL instead');
  }

  if (!redisUrl && !redisHost) {
    logger.warn('Redis not configured (missing REDIS_URL or REDIS_HOST) - queues will be disabled');
    return null;
  }

  const connectionConfig: ConnectionOptions = {
    host: redisHost || 'localhost',
    port: Number(redisPort) || 6379,
    password: redisPassword,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    connectTimeout: 60000,
    lazyConnect: true,
    // Enhanced connection settings for better reliability
    keepAlive: 30000,
    commandTimeout: 5000,
    // Optimize connection pooling to prevent exhaustion
    family: 4,
    enableReadyCheck: true,
    enableAutoPipelining: true,
    // Reduce connection count to prevent Redis client limit issues
    db: 0,
  } as any;

  // Use Redis URL if provided, otherwise use individual parameters
  if (redisUrl) {
    try {
      const url = new URL(redisUrl);
      (connectionConfig as any).host = url.hostname;
      (connectionConfig as any).port = parseInt(url.port) || 6379;
      if (url.password) {
        (connectionConfig as any).password = url.password;
      }

      logger.info('Redis connection configured via URL', {
        host: (connectionConfig as any).host,
        port: (connectionConfig as any).port,
        hasPassword: !!(connectionConfig as any).password,
      });
    } catch (error) {
      logger.error('Invalid REDIS_URL format, falling back to host/port config', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return connectionConfig;
};

const connectionConfig = getConnectionConfig();

// Queue names with priority levels
export const QUEUE_NAMES = {
  CRYPTO_SYNC: 'crypto-sync',
  CRYPTO_PRICES: 'crypto-prices',
  CRYPTO_ANALYTICS: 'crypto-analytics',
  NOTIFICATIONS: 'notifications',
  MAINTENANCE: 'maintenance',
} as const;

// Job types with priority classification
export const JOB_TYPES = {
  // High priority jobs
  SYNC_WALLET: 'sync-wallet',
  UPDATE_PRICES: 'update-prices',
  SEND_NOTIFICATION: 'send-notification',

  // Medium priority jobs
  SYNC_WALLET_FULL: 'sync-wallet-full',
  SYNC_TRANSACTIONS: 'sync-transactions',
  CALCULATE_PORTFOLIO: 'calculate-portfolio',

  // Low priority jobs
  SYNC_NFTS: 'sync-nfts',
  SYNC_DEFI: 'sync-defi',
  CREATE_SNAPSHOT: 'create-snapshot',
  CLEANUP_DATA: 'cleanup-data',
  GENERATE_REPORTS: 'generate-reports',
} as const;

// Job priorities
export const JOB_PRIORITIES = {
  CRITICAL: 100,
  HIGH: 75,
  NORMAL: 50,
  LOW: 25,
  BACKGROUND: 10,
} as const;

// Enhanced queue configuration with better performance settings
const queueOptions: QueueOptions | undefined = connectionConfig
  ? {
      connection: connectionConfig,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        delay: 0,
        priority: JOB_PRIORITIES.NORMAL,
      },
    }
  : undefined;

// Initialize queues only if Redis is available
export let cryptoSyncQueue: Queue | null = null;
export let cryptoPricesQueue: Queue | null = null;
export let cryptoAnalyticsQueue: Queue | null = null;
export let notificationsQueue: Queue | null = null;
export let maintenanceQueue: Queue | null = null;

if (queueOptions) {
  try {
    cryptoSyncQueue = new Queue(QUEUE_NAMES.CRYPTO_SYNC, queueOptions);
    cryptoPricesQueue = new Queue(QUEUE_NAMES.CRYPTO_PRICES, queueOptions);
    cryptoAnalyticsQueue = new Queue(QUEUE_NAMES.CRYPTO_ANALYTICS, queueOptions);
    notificationsQueue = new Queue(QUEUE_NAMES.NOTIFICATIONS, queueOptions);
    maintenanceQueue = new Queue(QUEUE_NAMES.MAINTENANCE, queueOptions);
    logger.info('BullMQ queues initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize queues:', error);
    cryptoSyncQueue = null;
    cryptoPricesQueue = null;
    cryptoAnalyticsQueue = null;
    notificationsQueue = null;
    maintenanceQueue = null;
  }
} else {
  logger.warn('Queues disabled - Redis not available');
}

// Enhanced Queue management class
export class QueueManager {
  private static instance: QueueManager;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private metrics: Map<string, QueueMetrics> = new Map();

  private constructor() {
    if (cryptoSyncQueue) this.queues.set(QUEUE_NAMES.CRYPTO_SYNC, cryptoSyncQueue);
    if (cryptoPricesQueue) this.queues.set(QUEUE_NAMES.CRYPTO_PRICES, cryptoPricesQueue);
    if (cryptoAnalyticsQueue) this.queues.set(QUEUE_NAMES.CRYPTO_ANALYTICS, cryptoAnalyticsQueue);
    if (notificationsQueue) this.queues.set(QUEUE_NAMES.NOTIFICATIONS, notificationsQueue);
    if (maintenanceQueue) this.queues.set(QUEUE_NAMES.MAINTENANCE, maintenanceQueue);

    this.initializeMetrics();
    this.setupEventListeners();
  }

  static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager();
    }
    return QueueManager.instance;
  }

  private initializeMetrics(): void {
    for (const queueName of this.queues.keys()) {
      this.metrics.set(queueName, {
        processed: 0,
        failed: 0,
        completed: 0,
        retries: 0,
        averageProcessingTime: 0,
        lastJobTime: null,
      });
    }
  }

  private setupEventListeners(): void {
    for (const [name, queue] of this.queues) {
      const metrics = this.metrics.get(name);
      if (!metrics) continue;

      (queue as any).on('completed', (job: Job) => {
        metrics.completed++;
        metrics.processed++;
        metrics.lastJobTime = new Date();

        if (job.processedOn && job.timestamp) {
          const processingTime = job.processedOn - job.timestamp;
          metrics.averageProcessingTime =
            (metrics.averageProcessingTime * (metrics.completed - 1) + processingTime) /
            metrics.completed;
        }

        logger.debug('Job completed', {
          queue: name,
          jobId: job.id,
          jobType: job.name,
          processingTime: job.processedOn && job.timestamp ? job.processedOn - job.timestamp : 0,
        });
      });

      (queue as any).on('failed', (job: Job | undefined, error: Error) => {
        metrics.failed++;
        metrics.processed++;

        logger.error('Job failed', {
          queue: name,
          jobId: job?.id,
          jobType: job?.name,
          error: error.message,
          attemptsMade: job?.attemptsMade,
          failedReason: job?.failedReason,
        });
      });

      (queue as any).on('stalled', (job: Job) => {
        logger.warn('Job stalled', {
          queue: name,
          jobId: job.id,
        });
      });

      queue.on('waiting', (job: Job) => {
        logger.debug('Job waiting', {
          queue: name,
          jobId: job.id,
        });
      });
    }
  }

  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  addWorker(queueName: string, worker: Worker): void {
    this.workers.set(queueName, worker);

    // Setup worker event listeners
    worker.on('completed', (job: Job) => {
      logger.info('Worker completed job', {
        queue: queueName,
        jobId: job.id,
        jobType: job.name,
      });
    });

    worker.on('failed', (job: Job | undefined, error: Error) => {
      logger.error('Worker failed job', {
        queue: queueName,
        jobId: job?.id,
        jobType: job?.name,
        error: error.message,
      });
    });

    worker.on('error', (error: Error) => {
      logger.error('Worker error', {
        queue: queueName,
        error: error.message,
      });
    });
  }

  // Enhanced job scheduling with intelligent priority assignment
  async addJob(
    queueName: string,
    jobType: string,
    data: any,
    options: {
      priority?: number;
      delay?: number;
      attempts?: number;
      backoff?: any;
      removeOnComplete?: number;
      removeOnFail?: number;
    } = {}
  ): Promise<Job | null> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      logger.error('Queue not found', { queueName });
      return null;
    }

    // Auto-assign priority based on job type
    const priority = options.priority || this.getJobPriority(jobType);

    try {
      const job = await queue.add(jobType, data, {
        priority,
        attempts: options.attempts || 3,
        backoff: options.backoff || { type: 'exponential', delay: 2000 },
        delay: options.delay || 0,
        removeOnComplete: options.removeOnComplete || 100,
        removeOnFail: options.removeOnFail || 50,
      });

      logger.debug('Job added to queue', {
        queue: queueName,
        jobId: job.id,
        jobType,
        priority,
        delay: options.delay,
      });

      return job;
    } catch (error) {
      logger.error('Failed to add job to queue', {
        queue: queueName,
        jobType,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // Get job priority based on type
  private getJobPriority(jobType: string): number {
    switch (jobType) {
      case JOB_TYPES.UPDATE_PRICES:
      case JOB_TYPES.SEND_NOTIFICATION:
        return JOB_PRIORITIES.CRITICAL;

      case JOB_TYPES.SYNC_WALLET:
      case JOB_TYPES.SYNC_TRANSACTIONS:
        return JOB_PRIORITIES.HIGH;

      case JOB_TYPES.SYNC_WALLET_FULL:
      case JOB_TYPES.CALCULATE_PORTFOLIO:
        return JOB_PRIORITIES.NORMAL;

      case JOB_TYPES.SYNC_NFTS:
      case JOB_TYPES.SYNC_DEFI:
        return JOB_PRIORITIES.LOW;

      case JOB_TYPES.CREATE_SNAPSHOT:
      case JOB_TYPES.CLEANUP_DATA:
      case JOB_TYPES.GENERATE_REPORTS:
        return JOB_PRIORITIES.BACKGROUND;

      default:
        return JOB_PRIORITIES.NORMAL;
    }
  }

  async closeAllQueues(): Promise<void> {
    const closePromises = Array.from(this.queues.values()).map((queue) => queue.close());
    const workerClosePromises = Array.from(this.workers.values()).map((worker) => worker.close());

    try {
      await Promise.all([...closePromises, ...workerClosePromises]);
      logger.info('All queues and workers closed successfully');
    } catch (error) {
      logger.error('Error closing queues:', error);
      throw error;
    }
  }

  async getQueueStats(): Promise<Record<string, QueueStats>> {
    const stats: Record<string, QueueStats> = {};

    for (const [name, queue] of this.queues) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed(),
          queue.getDelayed(),
        ]);

        const metrics = this.metrics.get(name);

        stats[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          metrics: metrics || {
            processed: 0,
            failed: 0,
            completed: 0,
            retries: 0,
            averageProcessingTime: 0,
            lastJobTime: null,
          },
        };
      } catch (error) {
        logger.error(`Error getting stats for queue ${name}:`, error);
        stats[name] = {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          error: 'Failed to get stats',
          metrics: {
            processed: 0,
            failed: 0,
            completed: 0,
            retries: 0,
            averageProcessingTime: 0,
            lastJobTime: null,
          },
        };
      }
    }

    return stats;
  }

  // Get detailed queue health information
  async getQueueHealth(): Promise<{
    healthy: boolean;
    queues: Record<
      string,
      {
        healthy: boolean;
        issues: string[];
        metrics: QueueMetrics;
      }
    >;
  }> {
    const health = {
      healthy: true,
      queues: {} as Record<
        string,
        {
          healthy: boolean;
          issues: string[];
          metrics: QueueMetrics;
        }
      >,
    };

    const stats = await this.getQueueStats();

    for (const [name, stat] of Object.entries(stats)) {
      const metrics = this.metrics.get(name);
      if (!metrics) continue;
      const issues: string[] = [];
      let queueHealthy = true;

      // Check for issues
      if (stat.failed > stat.completed * 0.1) {
        // More than 10% failure rate
        issues.push('High failure rate');
        queueHealthy = false;
      }

      if (stat.waiting > 1000) {
        // Too many waiting jobs
        issues.push('Large backlog');
        queueHealthy = false;
      }

      if (metrics.averageProcessingTime > 60000) {
        // More than 1 minute average
        issues.push('Slow processing');
        queueHealthy = false;
      }

      if (metrics.lastJobTime && Date.now() - metrics.lastJobTime.getTime() > 300000) {
        // No activity for 5 minutes
        issues.push('No recent activity');
        queueHealthy = false;
      }

      health.queues[name] = {
        healthy: queueHealthy,
        issues,
        metrics,
      };

      if (!queueHealthy) {
        health.healthy = false;
      }
    }

    return health;
  }

  // Clean up old completed and failed jobs
  async cleanupJobs(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    for (const [name, queue] of this.queues) {
      try {
        await queue.clean(olderThanMs, 100, 'completed');
        await queue.clean(olderThanMs, 50, 'failed');

        logger.info('Cleaned up old jobs', {
          queue: name,
          olderThanMs,
        });
      } catch (error) {
        logger.error('Failed to cleanup jobs', {
          queue: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Pause/Resume queue operations
  async pauseQueue(queueName: string): Promise<boolean> {
    const queue = this.getQueue(queueName);
    if (!queue) return false;

    try {
      await queue.pause();
      logger.info('Queue paused', { queue: queueName });
      return true;
    } catch (error) {
      logger.error('Failed to pause queue', {
        queue: queueName,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async resumeQueue(queueName: string): Promise<boolean> {
    const queue = this.getQueue(queueName);
    if (!queue) return false;

    try {
      await queue.resume();
      logger.info('Queue resumed', { queue: queueName });
      return true;
    } catch (error) {
      logger.error('Failed to resume queue', {
        queue: queueName,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

interface QueueMetrics {
  processed: number;
  failed: number;
  completed: number;
  retries: number;
  averageProcessingTime: number;
  lastJobTime: Date | null;
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  error?: string;
  metrics: QueueMetrics;
}

export const queueManager = QueueManager.getInstance();
