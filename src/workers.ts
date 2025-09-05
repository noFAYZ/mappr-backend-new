import { logger } from '@/utils/logger';
import { initializeCryptoWorkers } from '@/jobs/cryptoJobs';
import { queueManager } from '@/config/queue';

export async function initializeWorkers(): Promise<void> {
  try {
    logger.info('Initializing background workers...');
    
    // Initialize crypto workers (if queues are available)
    const queuesAvailable = process.env['REDIS_URL'] || process.env['REDIS_HOST'];
    if (queuesAvailable) {
      try {
        initializeCryptoWorkers();
        logger.info('Crypto workers initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize crypto workers:', error);
        logger.warn('Continuing without background workers - some features will be limited');
      }
    } else {
      logger.warn('Redis not configured - background workers will be disabled');
    }
    
    logger.info('Worker initialization completed');
  } catch (error) {
    logger.error('Failed to initialize workers:', error);
    // Don't throw error - allow server to start without workers
    logger.warn('Continuing without background workers');
  }
}

export async function shutdownWorkers(): Promise<void> {
  try {
    logger.info('Shutting down background workers...');
    
    await queueManager.closeAllQueues();
    
    logger.info('All background workers shut down successfully');
  } catch (error) {
    logger.error('Error shutting down workers:', error);
    throw error;
  }
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  try {
    await shutdownWorkers();
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  try {
    await shutdownWorkers();
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

export default {
  initialize: initializeWorkers,
  shutdown: shutdownWorkers
};