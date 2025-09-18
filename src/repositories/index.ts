// Repository pattern exports for centralized access
export { BaseRepository, type PaginationOptions, type PaginatedResult } from './BaseRepository';
export { CryptoWalletRepository } from './CryptoWalletRepository';
export { CryptoPositionRepository } from './CryptoPositionRepository';
export { CryptoTransactionRepository } from './CryptoTransactionRepository';
export { DeFiPositionRepository } from './DeFiPositionRepository';
export { UserRepository } from './UserRepository';
export { SubscriptionRepository } from './SubscriptionRepository';

// Repository container for dependency injection
import { PrismaClient } from '@prisma/client';
import { CryptoWalletRepository } from './CryptoWalletRepository';
import { CryptoPositionRepository } from './CryptoPositionRepository';
import { CryptoTransactionRepository } from './CryptoTransactionRepository';
import { DeFiPositionRepository } from './DeFiPositionRepository';
import { UserRepository } from './UserRepository';
import { SubscriptionRepository } from './SubscriptionRepository';

export class RepositoryContainer {
  private static instance: RepositoryContainer;

  public readonly cryptoWallet: CryptoWalletRepository;
  public readonly cryptoPosition: CryptoPositionRepository;
  public readonly cryptoTransaction: CryptoTransactionRepository;
  public readonly defiPosition: DeFiPositionRepository;
  public readonly user: UserRepository;
  public readonly subscription: SubscriptionRepository;

  constructor(private prisma: PrismaClient) {
    this.cryptoWallet = new CryptoWalletRepository(prisma);
    this.cryptoPosition = new CryptoPositionRepository(prisma);
    this.cryptoTransaction = new CryptoTransactionRepository(prisma);
    this.defiPosition = new DeFiPositionRepository(prisma);
    this.user = new UserRepository(prisma);
    this.subscription = new SubscriptionRepository(prisma);
  }

  static getInstance(prisma: PrismaClient): RepositoryContainer {
    if (!RepositoryContainer.instance) {
      RepositoryContainer.instance = new RepositoryContainer(prisma);
    }
    return RepositoryContainer.instance;
  }

  // Health check for all repositories
  async healthCheck(): Promise<{
    healthy: boolean;
    repositories: Record<
      string,
      {
        healthy: boolean;
        averageQueryTime: number;
        slowQueries: number;
        errorRate: number;
      }
    >;
  }> {
    const checks = await Promise.allSettled([
      this.cryptoWallet.healthCheck(),
      this.cryptoPosition.healthCheck(),
      this.cryptoTransaction.healthCheck(),
      this.defiPosition.healthCheck(),
      this.user.healthCheck(),
      this.subscription.healthCheck(),
    ]);

    const repositories = {
      cryptoWallet:
        checks[0].status === 'fulfilled'
          ? checks[0].value
          : { healthy: false, averageQueryTime: 0, slowQueries: 0, errorRate: 1 },
      cryptoPosition:
        checks[1].status === 'fulfilled'
          ? checks[1].value
          : { healthy: false, averageQueryTime: 0, slowQueries: 0, errorRate: 1 },
      cryptoTransaction:
        checks[2].status === 'fulfilled'
          ? checks[2].value
          : { healthy: false, averageQueryTime: 0, slowQueries: 0, errorRate: 1 },
      defiPosition:
        checks[3].status === 'fulfilled'
          ? checks[3].value
          : { healthy: false, averageQueryTime: 0, slowQueries: 0, errorRate: 1 },
      user:
        checks[4].status === 'fulfilled'
          ? checks[4].value
          : { healthy: false, averageQueryTime: 0, slowQueries: 0, errorRate: 1 },
      subscription:
        checks[5].status === 'fulfilled'
          ? checks[5].value
          : { healthy: false, averageQueryTime: 0, slowQueries: 0, errorRate: 1 },
    };

    const healthy = Object.values(repositories).every((repo) => repo.healthy);

    return {
      healthy,
      repositories,
    };
  }
}
