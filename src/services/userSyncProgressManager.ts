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
  private redis: Redis | null = null;
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
        this.redis = new Redis(redisUrl);

        // Subscribe to sync progress events
        this.redis.subscribe('wallet_sync_progress', 'wallet_sync_completed', 'wallet_sync_failed');

        this.redis.on('message', (channel, message) => {
          this.handleRedisMessage(channel, message);
        });

        logger.info('UserSyncProgressManager: Redis initialized and subscribed to sync events');
      } catch (error) {
        logger.error('UserSyncProgressManager: Failed to initialize Redis:', error);
        this.redis = null;
      }
    } else {
      logger.warn('UserSyncProgressManager: REDIS_URL not configured - real-time updates disabled');
    }
  }

  private handleRedisMessage(_channel: string, message: string) {
    try {
      const data = JSON.parse(message);
      const { userId, walletId } = data;

      if (!userId || !walletId) {
        logger.warn('UserSyncProgressManager: Invalid message format:', data);
        return;
      }

      this.broadcastToUser(userId, data);
    } catch (error) {
      logger.error('UserSyncProgressManager: Error processing Redis message:', error);
    }
  }

  addUserConnection(userId: string, response: Response, walletIds: string[] = []): boolean {
    try {
      // Check if user already has a connection
      if (this.connections.has(userId)) {
        this.removeUserConnection(userId);
      }

      // Setup SSE headers
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
       
        'Access-Control-Allow-Headers': 'Cache-Control',
        'X-Accel-Buffering': 'no' // Disable nginx buffering
      });

      // Send initial connection event
      this.writeSSEMessage(response, {
        type: 'connection_established',
        userId,
        timestamp: new Date().toISOString()
      });

      const connection: UserConnection = {
        userId,
        response,
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        walletIds: new Set(walletIds)
      };

      this.connections.set(userId, connection);

      // Handle client disconnect
      response.on('close', () => {
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
      return false;
    }

    try {
      this.writeSSEMessage(connection.response, data);
      return true;
    } catch (error) {
      logger.error(`UserSyncProgressManager: Error broadcasting to user ${userId}:`, error);
      this.removeUserConnection(userId);
      return false;
    }
  }

  broadcastWalletProgress(userId: string, walletId: string, progress: WalletSyncProgress) {
    const connection = this.connections.get(userId);
    if (!connection) {
      return false;
    }

    // Only broadcast if user is tracking this wallet
    if (!connection.walletIds.has(walletId)) {
      return false;
    }

    const eventData = {
      type: 'wallet_sync_progress',
      ...progress,
      walletId, // Ensure walletId from parameter takes precedence
      timestamp: new Date().toISOString()
    };

    return this.broadcastToUser(userId, eventData);
  }

  broadcastWalletCompleted(userId: string, walletId: string, result: any) {
    const eventData = {
      type: 'wallet_sync_completed',
      ...result,
      walletId, // Ensure walletId from parameter takes precedence
      timestamp: new Date().toISOString()
    };

    return this.broadcastToUser(userId, eventData);
  }

  broadcastWalletFailed(userId: string, walletId: string, error: any) {
    const eventData = {
      type: 'wallet_sync_failed',
      walletId,
      error: error.message || 'Unknown error',
      timestamp: new Date().toISOString()
    };

    return this.broadcastToUser(userId, eventData);
  }

  // Publish progress to Redis for broadcasting to all instances
  async publishProgress(userId: string, walletId: string, progress: WalletSyncProgress) {
    if (!this.redis) {
      // Fallback: broadcast directly if Redis not available
      this.broadcastWalletProgress(userId, walletId, progress);
      return;
    }

    try {
      await this.redis.publish('wallet_sync_progress', JSON.stringify({
        userId,
        ...progress,
        walletId // Ensure walletId from parameter takes precedence
      }));
    } catch (error) {
      logger.error('UserSyncProgressManager: Error publishing progress:', error);
      // Fallback to direct broadcast
      this.broadcastWalletProgress(userId, walletId, progress);
    }
  }

  async publishCompleted(userId: string, walletId: string, result: any) {
    if (!this.redis) {
      this.broadcastWalletCompleted(userId, walletId, result);
      return;
    }

    try {
      await this.redis.publish('wallet_sync_completed', JSON.stringify({
        userId,
        walletId,
        ...result
      }));
    } catch (error) {
      logger.error('UserSyncProgressManager: Error publishing completion:', error);
      this.broadcastWalletCompleted(userId, walletId, result);
    }
  }

  async publishFailed(userId: string, walletId: string, error: any) {
    if (!this.redis) {
      this.broadcastWalletFailed(userId, walletId, error);
      return;
    }

    try {
      await this.redis.publish('wallet_sync_failed', JSON.stringify({
        userId,
        walletId,
        error
      }));
    } catch (error) {
      logger.error('UserSyncProgressManager: Error publishing failure:', error);
      this.broadcastWalletFailed(userId, walletId, error);
    }
  }

  private writeSSEMessage(response: Response, data: any) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    response.write(message);
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const toRemove: string[] = [];

      for (const [userId, connection] of this.connections) {
        const timeSinceLastHeartbeat = now.getTime() - connection.lastHeartbeat.getTime();

        if (timeSinceLastHeartbeat > this.CONNECTION_TIMEOUT) {
          toRemove.push(userId);
        } else {
          // Send heartbeat
          try {
            this.writeSSEMessage(connection.response, {
              type: 'heartbeat',
              timestamp: now.toISOString()
            });
            connection.lastHeartbeat = now;
          } catch (error) {
            toRemove.push(userId);
          }
        }
      }

      // Remove stale connections
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

      // Close all connections
      for (const userId of this.connections.keys()) {
        this.removeUserConnection(userId);
      }

      if (this.redis) {
        this.redis.disconnect();
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
    return this.redis ? this.redis.status === 'ready' : true;
  }
}

// Singleton instance
export const userSyncProgressManager = new UserSyncProgressManager();