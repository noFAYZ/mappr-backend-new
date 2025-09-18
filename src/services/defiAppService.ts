/**
 * DeFiAppService - Service layer for new normalized DeFi app and position management
 */
import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { BlockchainNetwork, Prisma } from '@prisma/client';

// Type definitions for Zapper response structure
export interface ZapperApp {
  displayName: string;
  imgUrl?: string;
  description?: string;
  slug: string;
  url?: string;
  category?: {
    name: string;
  };
}

export interface ZapperNetwork {
  name: string;
  slug: string;
  chainId: number;
  evmCompatible?: boolean;
}

export interface ZapperPositionBalance {
  type: string;
  address: string;
  network: string;
  symbol: string;
  decimals: number;
  balance: string;
  balanceUSD: number;
  price: number;
  appId: string;
  groupId?: string;
  groupLabel?: string;
  supply?: number;
  pricePerShare?: number[];
  tokens?: any[];
  displayProps?: {
    label: string;
    images: string[];
    balanceDisplayMode?: string;
  };
}

export interface ZapperAppBalance {
  balanceUSD: number;
  app: ZapperApp;
  network: ZapperNetwork;
  positionBalances: {
    edges: Array<{
      node: ZapperPositionBalance;
    }>;
  };
}

export interface ZapperResponse {
  portfolioV2: {
    appBalances: {
      totalBalanceUSD: number;
      byApp: {
        totalCount: number;
        edges: Array<{
          node: ZapperAppBalance;
        }>;
      };
    };
  };
}

// Network mapping helper
const NETWORK_MAPPING: Record<string, BlockchainNetwork> = {
  ETHEREUM_MAINNET: 'ETHEREUM',
  ethereum: 'ETHEREUM',
  POLYGON_MAINNET: 'POLYGON',
  polygon: 'POLYGON',
  ARBITRUM_MAINNET: 'ARBITRUM',
  arbitrum: 'ARBITRUM',
  OPTIMISM_MAINNET: 'OPTIMISM',
  optimism: 'OPTIMISM',
  BSC_MAINNET: 'BSC',
  bsc: 'BSC',
  AVALANCHE_MAINNET: 'AVALANCHE',
  avalanche: 'AVALANCHE',
  BASE_MAINNET: 'BASE',
  base: 'BASE',
  FANTOM_MAINNET: 'FANTOM',
  fantom: 'FANTOM',
  CELO_MAINNET: 'CELO',
  celo: 'CELO',
};

export class DeFiAppService {
  /**
   * Sync DeFi apps and positions from Zapper response
   */
  async syncWalletDeFiData(walletId: string, zapperResponse: ZapperResponse) {
    try {
      const appBalances = zapperResponse.portfolioV2?.appBalances?.byApp?.edges || [];

      if (appBalances.length === 0) {
        logger.info('No DeFi app balances found', { walletId });
        return { apps: [], positions: [] };
      }

      const syncedApps: any[] = [];
      const syncedPositions: any[] = [];

      // Process each app balance
      for (const edge of appBalances) {
        const appBalance = edge.node;

        if (appBalance.balanceUSD <= 0) {
          continue; // Skip apps with no balance
        }

        // Sync or create the app
        const app = await this.syncApp(appBalance.app, appBalance.network);
        syncedApps.push(app);

        // Sync positions for this app
        const positions = await this.syncAppPositions(
          walletId,
          app.id,
          appBalance,
          this.mapNetwork(appBalance.network.slug)
        );
        syncedPositions.push(...positions);
      }

      // Clean up stale positions for this wallet
      await this.cleanupStalePositions(walletId);

      logger.info('DeFi data synced successfully', {
        walletId,
        appsCount: syncedApps.length,
        positionsCount: syncedPositions.length,
        totalValueUsd: zapperResponse.portfolioV2.appBalances.totalBalanceUSD,
      });

      return {
        apps: syncedApps,
        positions: syncedPositions,
      };
    } catch (error) {
      logger.error('Failed to sync DeFi data', {
        walletId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to sync DeFi data', 500);
    }
  }

  /**
   * Sync or create a DeFi app for a specific network
   */
  private async syncApp(zapperApp: ZapperApp, network: ZapperNetwork) {
    // Convert Zapper network name to our BlockchainNetwork enum
    const blockchainNetwork = this.mapZapperNetworkToBlockchain(network.name);

    // Find existing app for this slug + network combination
    const existingApp = await prisma.deFiApp.findFirst({
      where: {
        slug: zapperApp.slug,
        network: blockchainNetwork,
      },
    });

    if (existingApp) {
      // Update existing app
      return await prisma.deFiApp.update({
        where: { id: existingApp.id },
        data: {
          displayName: zapperApp.displayName,
          description: zapperApp.description || null,
          url: zapperApp.url || null,
          imgUrl: zapperApp.imgUrl || null,
          category: zapperApp.category?.name || null,
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new app for this network
      return await prisma.deFiApp.create({
        data: {
          slug: zapperApp.slug,
          network: blockchainNetwork,
          displayName: zapperApp.displayName,
          description: zapperApp.description || null,
          url: zapperApp.url || null,
          imgUrl: zapperApp.imgUrl || null,
          category: zapperApp.category?.name || null,
          isVerified: this.isVerifiedApp(zapperApp.slug),
          riskScore: this.getAppRiskScore(zapperApp.slug),
          lastSyncAt: new Date(),
        },
      });
    }
  }

  /**
   * Sync app positions for a wallet
   */
  private async syncAppPositions(
    walletId: string,
    appId: string,
    appBalance: ZapperAppBalance,
    network: BlockchainNetwork
  ) {
    const positions: any[] = [];
    const positionEdges = appBalance.positionBalances?.edges || [];

    for (const positionEdge of positionEdges) {
      const position = positionEdge.node;

      if (Number(position.balanceUSD) <= 0) {
        continue; // Skip positions with no value
      }

      const syncedPosition = await prisma.deFiAppPosition.upsert({
        where: {
          walletId_contractAddress_network_syncSource: {
            walletId,
            contractAddress: position.address,
            network,
            syncSource: 'zapper',
          },
        },
        update: {
          balance: position.balance || 0,
          balanceFormatted: this.formatBalance(position.balance, position.decimals),
          balanceUSD: position.balanceUSD,
          price: position.price || null,
          symbol: position.symbol || null,
          decimals: position.decimals || 18,
          groupId: position.groupId || null,
          groupLabel: position.groupLabel || null,
          positionType: position.type,
          metaType: this.determineMetaType(position),
          supply: position.supply || null,
          pricePerShare: position.pricePerShare || Prisma.JsonNull,
          tokens: position.tokens || Prisma.JsonNull,
          displayProps: position.displayProps || Prisma.JsonNull,
          isActive: true,
          lastSyncAt: new Date(),
          updatedAt: new Date(),
          rawData: JSON.parse(JSON.stringify(position)), // Store complete raw data for debugging
        },
        create: {
          walletId,
          appId,
          contractAddress: position.address,
          network,
          balance: position.balance || 0,
          balanceFormatted: this.formatBalance(position.balance, position.decimals),
          balanceUSD: position.balanceUSD,
          price: position.price || null,
          symbol: position.symbol || null,
          decimals: position.decimals || 18,
          groupId: position.groupId || null,
          groupLabel: position.groupLabel || null,
          positionType: position.type,
          metaType: this.determineMetaType(position),
          supply: position.supply || null,
          pricePerShare: position.pricePerShare || Prisma.JsonNull,
          tokens: position.tokens || Prisma.JsonNull,
          displayProps: position.displayProps || Prisma.JsonNull,
          syncSource: 'zapper',
          externalPositionId: `${position.appId}-${position.address}`,
          lastSyncAt: new Date(),
          rawData: JSON.parse(JSON.stringify(position)),
        },
      });

      positions.push(syncedPosition);
    }

    return positions;
  }

  /**
   * Clean up stale positions that weren't updated in this sync
   */
  private async cleanupStalePositions(walletId: string) {
    const staleCutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago

    // Mark positions as inactive if they weren't updated recently
    await prisma.deFiAppPosition.updateMany({
      where: {
        walletId,
        syncSource: 'zapper',
        lastSyncAt: {
          lt: staleCutoff,
        },
      },
      data: {
        isActive: false,
      },
    });

    // Delete very old inactive positions
    const deleteCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const deletedCount = await prisma.deFiAppPosition.deleteMany({
      where: {
        walletId,
        syncSource: 'zapper',
        isActive: false,
        lastSyncAt: {
          lt: deleteCutoff,
        },
      },
    });

    if (deletedCount.count > 0) {
      logger.info('Cleaned up stale DeFi positions', {
        walletId,
        deletedCount: deletedCount.count,
      });
    }
  }

  /**
   * Get DeFi apps and positions for a wallet
   */
  async getWalletDeFiData(userId: string, walletId: string) {
    try {
      // Verify wallet ownership
      const wallet = await prisma.cryptoWallet.findFirst({
        where: { id: walletId, userId },
      });

      if (!wallet) {
        throw new AppError('Wallet not found or access denied', 404);
      }

      // Get positions with app data
      const positions = await prisma.deFiAppPosition.findMany({
        where: {
          walletId,
          isActive: true,
        },
        include: {
          app: true,
        },
        orderBy: [{ balanceUSD: 'desc' }, { createdAt: 'desc' }],
      });

      // Group positions by app
      const appGroups = new Map();

      for (const position of positions) {
        const appId = position.app.id;
        if (!appGroups.has(appId)) {
          appGroups.set(appId, {
            app: position.app,
            positions: [],
            totalBalanceUSD: 0,
          });
        }

        const group = appGroups.get(appId);
        group.positions.push(position);
        group.totalBalanceUSD += Number(position.balanceUSD);
      }

      const apps = Array.from(appGroups.values()).sort(
        (a, b) => b.totalBalanceUSD - a.totalBalanceUSD
      );

      return {
        totalValueUSD: positions.reduce((sum, pos) => sum + Number(pos.balanceUSD), 0),
        totalPositions: positions.length,
        totalApps: apps.length,
        apps,
        positions,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Failed to get wallet DeFi data', {
        userId,
        walletId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new AppError('Failed to fetch DeFi data', 500);
    }
  }

  /**
   * Get DeFi analytics using new normalized schema
   */
  async getDeFiAnalytics(userId: string, walletId: string) {
    try {
      const defiData = await this.getWalletDeFiData(userId, walletId);

      if (defiData.totalPositions === 0) {
        return this.getEmptyAnalytics();
      }

      const positions = defiData.positions;

      // Calculate claimable rewards
      const claimableRewards = positions
        .filter((pos) => pos.metaType === 'CLAIMABLE')
        .map((pos) => ({
          protocolName: pos.app.displayName,
          amount: Number(pos.balance),
          amountUsd: Number(pos.balanceUSD),
          token: {
            symbol: pos.symbol || 'UNKNOWN',
            address: pos.contractAddress,
          },
        }));

      // Calculate LP positions
      const lpPositions = positions
        .filter((pos) => pos.positionType === 'app-token' && pos.tokens)
        .map((pos) => ({
          protocolName: pos.app.displayName,
          poolName: pos.groupLabel || 'Unknown Pool',
          totalValueUsd: Number(pos.balanceUSD),
          tokens:
            pos.tokens && Array.isArray(pos.tokens)
              ? (pos.tokens as any[]).map((token: any) => ({
                  symbol: token.symbol || 'UNKNOWN',
                  balance: Number(token.balance || 0),
                  balanceUsd: Number(token.balanceUSD || 0),
                }))
              : [],
        }));

      // Group by protocol for analytics
      const protocolBreakdown = defiData.apps.reduce(
        (acc, appGroup) => {
          const totalValue = appGroup.totalBalanceUSD;
          const positionCount = appGroup.positions.length;

          // Calculate average APY if available
          const apyValues = appGroup.positions
            .filter((pos: any) => pos.apy)
            .map((pos: any) => Number(pos.apy));

          acc[appGroup.app.displayName] = {
            totalValueUsd: totalValue,
            positionCount,
            avgAPY:
              apyValues.length > 0
                ? apyValues.reduce((sum: number, apy: number) => sum + apy, 0) / apyValues.length
                : undefined,
            category: appGroup.app.category,
            riskScore: appGroup.app.riskScore,
            isVerified: appGroup.app.isVerified,
          };

          return acc;
        },
        {} as Record<string, any>
      );

      // Calculate network distribution
      const networkDistribution = positions.reduce(
        (acc, pos) => {
          const network = pos.network;
          acc[network] = (acc[network] || 0) + Number(pos.balanceUSD);
          return acc;
        },
        {} as Record<string, number>
      );

      // Calculate position type distribution
      const positionTypeDistribution = positions.reduce(
        (acc, pos) => {
          const type = pos.positionType;
          acc[type] = (acc[type] || 0) + Number(pos.balanceUSD);
          return acc;
        },
        {} as Record<string, number>
      );

      // Calculate meta type distribution
      const metaTypeDistribution = positions.reduce(
        (acc, pos) => {
          const metaType = pos.metaType || 'UNKNOWN';
          acc[metaType] = (acc[metaType] || 0) + Number(pos.balanceUSD);
          return acc;
        },
        {} as Record<string, number>
      );

      // Calculate yield metrics
      const totalYieldEarned = positions.reduce(
        (sum, pos) => sum + Number(pos.yieldEarnedUsd || 0),
        0
      );

      const avgAPY = this.calculateWeightedAPY(positions);

      // Calculate net worth breakdown
      const suppliedValue = positions
        .filter((pos) => pos.metaType === 'SUPPLIED')
        .reduce((sum, pos) => sum + Number(pos.balanceUSD), 0);

      const borrowedValue = positions
        .filter((pos) => pos.metaType === 'BORROWED')
        .reduce((sum, pos) => sum + Number(pos.balanceUSD), 0);

      const stakedValue = positions
        .filter((pos) => pos.metaType === 'STAKED')
        .reduce((sum, pos) => sum + Number(pos.balanceUSD), 0);

      const netWorth = {
        totalSupplied: suppliedValue,
        totalBorrowed: borrowedValue,
        totalStaked: stakedValue,
        netWorth: defiData.totalValueUSD,
        healthRatio: borrowedValue > 0 ? suppliedValue / borrowedValue : null,
      };

      return {
        summary: {
          totalValueUsd: defiData.totalValueUSD,
          totalYieldEarned,
          activePositions: defiData.totalPositions,
          protocolCount: defiData.totalApps,
          avgAPY,
          networkDistribution,
          positionTypeDistribution,
          metaTypeDistribution,
          netWorth,
        },
        claimableRewards,
        lpPositions,
        protocolBreakdown,
        apps: defiData.apps, // Include full app data
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Failed to get DeFi analytics', {
        userId,
        walletId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new AppError('Failed to calculate DeFi analytics', 500);
    }
  }

  private getEmptyAnalytics() {
    return {
      summary: {
        totalValueUsd: 0,
        totalYieldEarned: 0,
        activePositions: 0,
        protocolCount: 0,
        avgAPY: 0,
        networkDistribution: {},
        positionTypeDistribution: {},
        metaTypeDistribution: {},
        netWorth: {
          totalSupplied: 0,
          totalBorrowed: 0,
          totalStaked: 0,
          netWorth: 0,
          healthRatio: null,
        },
      },
      claimableRewards: [],
      lpPositions: [],
      protocolBreakdown: {},
      apps: [],
    };
  }

  private calculateWeightedAPY(positions: any[]): number {
    const totalValue = positions.reduce((sum, pos) => sum + Number(pos.balanceUSD), 0);

    if (totalValue === 0) return 0;

    const weightedSum = positions.reduce((sum, pos) => {
      const apy = Number(pos.apy || 0);
      const weight = Number(pos.balanceUSD) / totalValue;
      return sum + apy * weight;
    }, 0);

    return weightedSum;
  }

  // Helper methods
  private mapNetwork(networkSlug: string): BlockchainNetwork {
    const network = NETWORK_MAPPING[networkSlug];
    if (!network) {
      logger.warn('Unknown network slug', { networkSlug });
      return 'ETHEREUM'; // Default fallback
    }
    return network;
  }

  private formatBalance(
    balance: string | number | null | undefined,
    decimals: number | null | undefined
  ): string {
    if (!balance || balance === null || balance === undefined) {
      return '0';
    }

    const balanceNumber = Number(balance);
    if (isNaN(balanceNumber) || balanceNumber === 0) {
      return '0';
    }

    const decimalPlaces = decimals || 18;
    const divisor = Math.pow(10, decimalPlaces);
    const formattedBalance = balanceNumber / divisor;

    if (formattedBalance < 0.0001) {
      return '< 0.0001';
    }

    return formattedBalance.toFixed(4);
  }

  private determineMetaType(position: ZapperPositionBalance): string {
    // Determine meta type based on position characteristics
    if (position.type === 'app-token' && position.groupId?.includes('staking')) {
      return 'STAKED';
    }

    if (position.type === 'app-token' && position.groupId?.includes('lending')) {
      return 'SUPPLIED';
    }

    if (position.type === 'contract-position') {
      return 'LP_TOKEN';
    }

    // Check for claimable rewards based on position type or other indicators
    if (position.type === 'claimable' || position.groupLabel?.toLowerCase().includes('reward')) {
      return 'CLAIMABLE';
    }

    return 'SUPPLIED'; // Default
  }

  private isVerifiedApp(slug: string): boolean {
    // List of well-known, verified DeFi apps
    const verifiedApps = [
      'lido',
      'aave',
      'compound',
      'uniswap-v2',
      'uniswap-v3',
      'curve',
      'balancer-v2',
      'sushiswap',
      'yearn',
      'makerdao',
      'convex',
      'frax',
      'rocket-pool',
      'ethereum',
    ];

    return verifiedApps.includes(slug);
  }

  private getAppRiskScore(slug: string): number {
    // Risk scoring for different protocols (0-100, higher = riskier)
    const riskScores: Record<string, number> = {
      lido: 15,
      aave: 20,
      compound: 25,
      'uniswap-v2': 30,
      'uniswap-v3': 35,
      curve: 25,
      'balancer-v2': 30,
      sushiswap: 40,
      yearn: 35,
      makerdao: 20,
      convex: 45,
      frax: 40,
      'rocket-pool': 25,
      ethereum: 10, // Native staking
    };

    return riskScores[slug] || 50; // Default medium risk
  }

  /**
   * Map Zapper network name to our BlockchainNetwork enum
   */
  private mapZapperNetworkToBlockchain(zapperNetworkName: string): any {
    const networkMap: Record<string, string> = {
      ethereum: 'ETHEREUM',
      ethereum_mainnet: 'ETHEREUM',
      polygon: 'POLYGON',
      'binance-smart-chain': 'BSC',
      bsc: 'BSC',
      arbitrum: 'ARBITRUM',
      optimism: 'OPTIMISM',
      avalanche: 'AVALANCHE',
      fantom: 'FANTOM',
      base: 'BASE',
      base_mainnet: 'BASE',
      celo: 'CELO',
    };

    const normalizedName = zapperNetworkName.toLowerCase().replace(/-/g, '_');
    const mappedNetwork = networkMap[normalizedName];

    if (!mappedNetwork) {
      logger.warn(`Unknown network slug: ${zapperNetworkName}, defaulting to ETHEREUM`);
    }

    return mappedNetwork || 'ETHEREUM'; // Default to Ethereum
  }

  async updatePositionMetrics(
    userId: string,
    positionId: string,
    updates: {
      apr?: number;
      apy?: number;
      yieldEarnedUsd?: number;
    }
  ) {
    try {
      // Verify position ownership
      const position = await prisma.deFiAppPosition.findFirst({
        where: {
          id: positionId,
          wallet: {
            userId,
          },
        },
      });

      if (!position) {
        throw new Error('Position not found or access denied');
      }

      const updated = await prisma.deFiAppPosition.update({
        where: { id: positionId },
        data: {
          ...updates,
          updatedAt: new Date(),
        },
        include: { app: true },
      });

      logger.info('DeFi position metrics updated', {
        userId,
        positionId,
        updates,
      });

      return updated;
    } catch (error) {
      logger.error('Error updating DeFi position metrics:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const defiAppService = new DeFiAppService();
