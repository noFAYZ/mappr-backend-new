import { Response } from 'express';
import Redis from 'ioredis';
import { logger } from '@/utils/logger';

export interface WalletSyncProgress {
  walletId: string;
  progress: number;
  status: 'queued' | 'syncing' | 'syncing_assets' | 'syncing_transactions' | 'syncing_nfts' | 'syncing_defi' | 'completed' | 'failed';
  message?: string;
  error?: string;
  syncedData?: string[];
  estimatedTimeRemaining?: number;
  startedAt?: Date;
  completedAt?: Date;
}

export interface UserConnection {
  userId: string;
  response: Response;
  connectedAt: Date;
  lastHeartbeat: Date;
  walletIds: Set<string>;
}

export class UserSyncProgressManager {
  private connections = new Map<string, UserConnection>();
  private redisSubscriber: Redis | null = null;
  private redisPublisher: Redis | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly CONNECTION_TIMEOUT = 60000; // 60 seconds

  constructor() {
    this.initializeRedis();
    this.startHeartbeat();
    this.setupGracefulShutdown();
  }

  private initializeRedis() {
    const redisUrl = process.env['REDIS_URL'];
    if (redisUrl) {
      try {
        this.redisSubscriber = new Redis(redisUrl);
        this.redisPublisher = new Redis(redisUrl);

        this.redisSubscriber.subscribe('wallet_sync_progress', 'wallet_sync_completed', 'wallet_sync_failed');

        this.redisSubscriber.on('message', (channel, message) => {
          this.handleRedisMessage(channel, message);
        });

        logger.info('UserSyncProgressManager: Redis subscriber and publisher initialized');
      } catch (error) {
        logger.error('UserSyncProgressManager: Failed to initialize Redis:', error);
        this.redisSubscriber = null;
        this.redisPublisher = null;
      }
    } else {
      logger.warn('UserSyncProgressManager: REDIS_URL not configured - real-time updates disabled');
    }
  }

  private handleRedisMessage(channel: string, message: string) {
    logger.debug(`UserSyncProgressManager: Received Redis message on channel '${channel}':`, message);
    try {
      const data = JSON.parse(message);
      const { userId, walletId } = data;

      if (!userId || !walletId) {
        logger.warn('UserSyncProgressManager: Invalid message format:', data);
        return;
      }

      logger.info(`UserSyncProgressManager: Broadcasting message to user ${userId} for wallet ${walletId}`);
      
      // Route based on channel to ensure correct message type
      let messageType: string;
      switch (channel) {
        case 'wallet_sync_progress':
          messageType = 'wallet_sync_progress';
          break;
        case 'wallet_sync_completed':
          messageType = 'wallet_sync_completed';
          break;
        case 'wallet_sync_failed':
          messageType = 'wallet_sync_failed';
          break;
        default:
          logger.warn('Unknown Redis channel:', channel);
          return;
      }

      const broadcastData = { ...data, type: messageType };
      const success = this.broadcastToUser(userId, broadcastData);
      logger.debug(`UserSyncProgressManager: Broadcast result: ${success}`);
    } catch (error) {
      logger.error('UserSyncProgressManager: Error processing Redis message:', error);
    }
  }

  addUserConnection(userId: string, response: Response, walletIds: string[] = []): boolean {
    try {
      if (this.connections.has(userId)) {
        this.removeUserConnection(userId);
      }

      const origin = (response.req as any)?.headers?.origin || 'http://localhost:3001';

      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Cache-Control, Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'X-Accel-Buffering': 'no'
      });

      // Send initial connection event
      this.writeSSEMessage(response, {
        type: 'connection_established',
        userId,
        timestamp: new Date().toISOString()
      });

      // Send immediate heartbeat
      setTimeout(() => {
        if (!response.destroyed && this.connections.has(userId)) {
          this.writeSSEMessage(response, {
            type: 'heartbeat',
            timestamp: new Date().toISOString()
          });
        }
      }, 1000);

      const connection: UserConnection = {
        userId,
        response,
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        walletIds: new Set(walletIds)
      };

      this.connections.set(userId, connection);

      response.on('close', () => {
        logger.info(`UserSyncProgressManager: Client disconnected (close event) for user ${userId}`);
        this.removeUserConnection(userId);
      });

      response.on('error', (error) => {
        logger.error(`UserSyncProgressManager: Connection error for user ${userId}:`, error);
        this.removeUserConnection(userId);
      });

      logger.info(`UserSyncProgressManager: User ${userId} connected with ${walletIds.length} wallets`);
      return true;
    } catch (error) {
      logger.error('UserSyncProgressManager: Error adding user connection:', error);
      return false;
    }
  }

  removeUserConnection(userId: string) {
    const connection = this.connections.get(userId);
    if (connection) {
      try {
        if (!connection.response.destroyed) {
          connection.response.end();
        }
      } catch (error) {
        logger.warn('UserSyncProgressManager: Error closing connection:', error);
      }

      this.connections.delete(userId);
      logger.info(`UserSyncProgressManager: User ${userId} disconnected`);
    }
  }

  addWalletToUser(userId: string, walletId: string) {
    const connection = this.connections.get(userId);
    if (connection) {
      connection.walletIds.add(walletId);
      logger.debug(`UserSyncProgressManager: Added wallet ${walletId} to user ${userId}`);
    }
  }

  removeWalletFromUser(userId: string, walletId: string) {
    const connection = this.connections.get(userId);
    if (connection) {
      connection.walletIds.delete(walletId);
      logger.debug(`UserSyncProgressManager: Removed wallet ${walletId} from user ${userId}`);
    }
  }

  broadcastToUser(userId: string, data: any) {
    const connection = this.connections.get(userId);
    if (!connection || connection.response.destroyed) {
      logger.debug(`UserSyncProgressManager: No active connection for user ${userId}`);
      return false;
    }

    try {
      this.writeSSEMessage(connection.response, data);
      logger.debug(`UserSyncProgressManager: Successfully broadcast to user ${userId}:`, data.type);
      return true;
    } catch (error) {
      logger.error(`UserSyncProgressManager: Error broadcasting to user ${userId}:`, error);
      this.removeUserConnection(userId);
      return false;
    }
  }

  async broadcastWalletProgress(userId: string, walletId: string, progress: WalletSyncProgress) {
    const connection = this.connections.get(userId);
    if (!connection) {
      logger.debug(`UserSyncProgressManager: No connection for user ${userId}`);
      return false;
    }

    if (!connection.walletIds.has(walletId)) {
      logger.debug(`UserSyncProgressManager: User ${userId} not tracking wallet ${walletId}`);
      return false;
    }

    const eventData = {
      type: 'wallet_sync_progress',
      walletId,
      progress: progress.progress,
      status: progress.status,
      message: progress.message,
      error: progress.error,
      startedAt: progress.startedAt?.toISOString(),
      completedAt: progress.completedAt?.toISOString(),
      syncedData: progress.syncedData,
      estimatedTimeRemaining: progress.estimatedTimeRemaining,
      timestamp: new Date().toISOString()
    };

    logger.debug(`UserSyncProgressManager: Broadcasting wallet progress:`, eventData);
    return this.broadcastToUser(userId, eventData);
  }

  broadcastWalletCompleted(userId: string, walletId: string, result: any) {
    const eventData = {
      type: 'wallet_sync_completed',
      walletId,

      syncedData: result.syncedData,
      completedAt: result.completedAt?.toISOString() || new Date().toISOString(),
      timestamp: new Date().toISOString()
    };

    logger.debug(`UserSyncProgressManager: Broadcasting wallet completion:`, eventData);
    return this.broadcastToUser(userId, eventData);
  }

  broadcastWalletFailed(userId: string, walletId: string, error: any) {
    const eventData = {
      type: 'wallet_sync_failed',
      walletId,
      error: error.message || error || 'Unknown error',
      timestamp: new Date().toISOString()
    };

    logger.debug(`UserSyncProgressManager: Broadcasting wallet failure:`, eventData);
    return this.broadcastToUser(userId, eventData);
  }

  // Publish progress to Redis for broadcasting to all instances
  async publishProgress(userId: string, walletId: string, progress: WalletSyncProgress) {
    logger.info(`UserSyncProgressManager: Publishing progress for user ${userId}, wallet ${walletId}:`, progress);

    if (!this.redisPublisher) {
      logger.info('UserSyncProgressManager: Redis publisher not available, using direct broadcast');
      this.broadcastWalletProgress(userId, walletId, progress);
      return;
    }

    try {
      const message = JSON.stringify({
        userId,
        walletId,
        progress: progress.progress,
        status: progress.status,
        message: progress.message,
        error: progress.error,
        startedAt: progress.startedAt?.toISOString(),
        completedAt: progress.completedAt?.toISOString(),
        syncedData: progress.syncedData,
        estimatedTimeRemaining: progress.estimatedTimeRemaining
      });
      
      logger.debug(`UserSyncProgressManager: Publishing to Redis channel 'wallet_sync_progress':`, message);
      await this.redisPublisher.publish('wallet_sync_progress', message);
      logger.debug('UserSyncProgressManager: Successfully published to Redis');
    } catch (error) {
      logger.error('UserSyncProgressManager: Error publishing progress:', error);
      this.broadcastWalletProgress(userId, walletId, progress);
    }
  }

  async publishCompleted(userId: string, walletId: string, result: any) {
    logger.info(`UserSyncProgressManager: Publishing completion for user ${userId}, wallet ${walletId}`);

    if (!this.redisPublisher) {
      this.broadcastWalletCompleted(userId, walletId, result);
      return;
    }

    try {
      const message = JSON.stringify({
        userId,
        walletId,
        syncedData: result.syncedData,
        completedAt: result.completedAt?.toISOString() || new Date().toISOString()
      });

      await this.redisPublisher.publish('wallet_sync_completed', message);
      logger.debug('UserSyncProgressManager: Successfully published completion to Redis');
    } catch (error) {
      logger.error('UserSyncProgressManager: Error publishing completion:', error);
      this.broadcastWalletCompleted(userId, walletId, result);
    }
  }

  async publishFailed(userId: string, walletId: string, error: any) {
    logger.info(`UserSyncProgressManager: Publishing failure for user ${userId}, wallet ${walletId}`);

    if (!this.redisPublisher) {
      this.broadcastWalletFailed(userId, walletId, error);
      return;
    }

    try {
      const message = JSON.stringify({
        userId,
        walletId,
        error: error.message || error || 'Unknown error'
      });

      await this.redisPublisher.publish('wallet_sync_failed', message);
      logger.debug('UserSyncProgressManager: Successfully published failure to Redis');
    } catch (error) {
      logger.error('UserSyncProgressManager: Error publishing failure:', error);
      this.broadcastWalletFailed(userId, walletId, error);
    }
  }

  private writeSSEMessage(response: Response, data: any) {
    try {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      if (!response.destroyed) {
        response.write(message);
        if (typeof response.flush === 'function') {
          response.flush();
        }
      }
    } catch (error) {
      logger.error('UserSyncProgressManager: Error writing SSE message:', error);
      throw error;
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const toRemove: string[] = [];

      for (const [userId, connection] of this.connections) {
        const timeSinceLastHeartbeat = now.getTime() - connection.lastHeartbeat.getTime();

        if (timeSinceLastHeartbeat > this.CONNECTION_TIMEOUT) {
          logger.info(`UserSyncProgressManager: Connection timeout for user ${userId}`);
          toRemove.push(userId);
        } else {
          try {
            this.writeSSEMessage(connection.response, {
              type: 'heartbeat',
              timestamp: now.toISOString()
            });
            connection.lastHeartbeat = now;
          } catch (error) {
            logger.warn(`UserSyncProgressManager: Failed to send heartbeat to user ${userId}:`, error);
            toRemove.push(userId);
          }
        }
      }

      toRemove.forEach(userId => this.removeUserConnection(userId));

      if (toRemove.length > 0) {
        logger.info(`UserSyncProgressManager: Removed ${toRemove.length} stale connections`);
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private setupGracefulShutdown() {
    const shutdown = () => {
      logger.info('UserSyncProgressManager: Shutting down...');

      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      for (const userId of this.connections.keys()) {
        this.removeUserConnection(userId);
      }

      if (this.redisPublisher) {
        this.redisPublisher.disconnect();
      }
      if (this.redisSubscriber) {
        this.redisSubscriber.disconnect();
      }

      logger.info('UserSyncProgressManager: Shutdown complete');
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  // Get connection statistics
  getStats() {
    return {
      totalConnections: this.connections.size,
      connections: Array.from(this.connections.entries()).map(([userId, connection]) => ({
        userId,
        connectedAt: connection.connectedAt,
        walletCount: connection.walletIds.size,
        wallets: Array.from(connection.walletIds)
      }))
    };
  }

  // Health check
  isHealthy(): boolean {
    return (this.redisPublisher?.status === 'ready' && this.redisSubscriber?.status === 'ready') ||
           (!this.redisPublisher && !this.redisSubscriber);
  }
}

// Singleton instance
export const userSyncProgressManager = new UserSyncProgressManager();