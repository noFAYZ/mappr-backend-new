import app from './app';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { connectDatabase } from '@/config/database';
import { initializeWorkers, shutdownWorkers } from '@/workers';

async function startServer() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Database connected successfully');

    // Initialize background workers
    await initializeWorkers();
    logger.info('Background workers initialized');

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
      logger.info(`Health check available at http://localhost:${config.port}/health`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');

      try {
        await shutdownWorkers();
        server.close(() => {
          logger.info('HTTP server closed');
          process.exit(0);
        });
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received: closing HTTP server');

      try {
        await shutdownWorkers();
        server.close(() => {
          logger.info('HTTP server closed');
          process.exit(0);
        });
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
