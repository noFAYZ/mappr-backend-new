import { Queue, Worker, QueueOptions, ConnectionOptions } from 'bullmq';
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
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
    connectTimeout: 60000,
    lazyConnect: true,
    // Enhanced connection settings for better reliability
    keepAlive: 30000,
    commandTimeout: 5000,
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
        hasPassword: !!(connectionConfig as any).password
      });
    } catch (error) {
      logger.error('Invalid REDIS_URL format, falling back to host/port config', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return connectionConfig;
};

const connectionConfig = getConnectionConfig();

// Queue names
export const QUEUE_NAMES = {
  CRYPTO_SYNC: 'crypto-sync',
  CRYPTO_PRICES: 'crypto-prices',
  CRYPTO_ANALYTICS: 'crypto-analytics',
} as const;

// Job types
export const JOB_TYPES = {
  SYNC_WALLET: 'sync-wallet',
  SYNC_WALLET_FULL: 'sync-wallet-full',
  UPDATE_PRICES: 'update-prices',
  SYNC_TRANSACTIONS: 'sync-transactions',
  SYNC_NFTS: 'sync-nfts',
  SYNC_DEFI: 'sync-defi',
  CALCULATE_PORTFOLIO: 'calculate-portfolio',
  CREATE_SNAPSHOT: 'create-snapshot',
} as const;

// Enhanced queue configuration with better performance settings
const queueOptions: QueueOptions | undefined = connectionConfig ? {
  connection: connectionConfig,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    // Enhanced job options for better reliability
    delay: 0,
    priority: 0,
  },
} : undefined;

// Initialize queues only if Redis is available
export let cryptoSyncQueue: Queue | null = null;
export let cryptoPricesQueue: Queue | null = null;
export let cryptoAnalyticsQueue: Queue | null = null;

if (queueOptions) {
  try {
    cryptoSyncQueue = new Queue(QUEUE_NAMES.CRYPTO_SYNC, queueOptions);
    cryptoPricesQueue = new Queue(QUEUE_NAMES.CRYPTO_PRICES, queueOptions);
    cryptoAnalyticsQueue = new Queue(QUEUE_NAMES.CRYPTO_ANALYTICS, queueOptions);
    logger.info('BullMQ queues initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize queues:', error);
    cryptoSyncQueue = null;
    cryptoPricesQueue = null;
    cryptoAnalyticsQueue = null;
  }
} else {
  logger.warn('Queues disabled - Redis not available');
}

// Queue management class
export class QueueManager {
  private static instance: QueueManager;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();

  private constructor() {
    if (cryptoSyncQueue) this.queues.set(QUEUE_NAMES.CRYPTO_SYNC, cryptoSyncQueue);
    if (cryptoPricesQueue) this.queues.set(QUEUE_NAMES.CRYPTO_PRICES, cryptoPricesQueue);
    if (cryptoAnalyticsQueue) this.queues.set(QUEUE_NAMES.CRYPTO_ANALYTICS, cryptoAnalyticsQueue);
  }

  static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager();
    }
    return QueueManager.instance;
  }

  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  addWorker(queueName: string, worker: Worker): void {
    this.workers.set(queueName, worker);
  }

  async closeAllQueues(): Promise<void> {
    const closePromises = Array.from(this.queues.values()).map(queue => queue.close());
    const workerClosePromises = Array.from(this.workers.values()).map(worker => worker.close());
    
    try {
      await Promise.all([...closePromises, ...workerClosePromises]);
      logger.info('All queues and workers closed successfully');
    } catch (error) {
      logger.error('Error closing queues:', error);
      throw error;
    }
  }

  async getQueueStats() {
    const stats: Record<string, any> = {};
    
    for (const [name, queue] of this.queues) {
      try {
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();
        
        stats[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
        };
      } catch (error) {
        logger.error(`Error getting stats for queue ${name}:`, error);
        stats[name] = { error: 'Failed to get stats' };
      }
    }
    
    return stats;
  }
}

// Queue event handlers - disabled for now due to TypeScript issues
// These would be enabled in a production environment with proper typing

export const queueManager = QueueManager.getInstance();