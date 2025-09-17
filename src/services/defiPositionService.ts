/**
 * DeFiPositionService - Service layer for DeFi position management
 */
import { prisma } from '@/config/database';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { BlockchainNetwork, DeFiPosition } from '@prisma/client';
import { parseAppBalances } from '@/utils/zapper/appBalanceParser';
import {
  zapperDeFiMapper,
  DeFiPositionCreateInput,
  DeFiPortfolioSummary,
} from '@/utils/defi/zapperMapper';
import { GraphQLResponse } from '@/utils/zapper/appBalanceParser';

export interface DeFiPositionFilters {
  protocolName?: string;
  protocolType?: string;
  positionType?: string;
  network?: BlockchainNetwork;
  metaType?: string;
  isActive?: boolean;
  minValueUsd?: number;
  maxValueUsd?: number;
}

export interface DeFiPositionWithWallet extends DeFiPosition {
  wallet: {
    id: string;
    address: string;
    name: string;
    network: BlockchainNetwork;
  };
}

export interface DeFiAnalytics {
  summary: DeFiPortfolioSummary;
  claimableRewards: Array<{
    protocolName: string;
    amount: number;
    amountUsd: number;
    token: {
      symbol: string;
      address: string;
    };
  }>;
  lpPositions: Array<{
    protocolName: string;
    poolName: string;
    totalValueUsd: number;
    tokens: Array<{
      symbol: string;
      balance: number;
      balanceUsd: number;
    }>;
  }>;
  protocolBreakdown: Record<
    string,
    {
      totalValueUsd: number;
      positionCount: number;
      avgAPY?: number;
    }
  >;
  riskMetrics: {
    diversificationScore: number; // 0-100
    protocolRiskScore: number; // 0-100
    liquidityScore: number; // 0-100
    overallRiskScore: number; // 0-100
  };
}

export class DeFiPositionService {
  /**
   * Sync DeFi positions for a wallet from Zapper data
   */
  async syncWalletDeFiPositions(
    walletId: string,
    zapperResponse: GraphQLResponse
  ): Promise<DeFiPosition[]> {
    try {
      // Parse Zapper response
      const parsedData = parseAppBalances(zapperResponse);

      // Transform to database format
      const positionsToSync: DeFiPositionCreateInput[] = [];

      for (const app of parsedData.apps) {
        if (app.balanceUSD > 0) {
          // Only sync positions with value
          const appPositions = zapperDeFiMapper.mapParsedAppToPositions(walletId, app);
          positionsToSync.push(...appPositions);
        }
      }

      // Sync to database
      const syncedPositions = await this.batchUpsertPositions(walletId, positionsToSync);

      logger.info('DeFi positions synced successfully', {
        walletId,
        positionCount: syncedPositions.length,
        totalValueUsd: positionsToSync.reduce((sum, pos) => sum + pos.totalValueUsd, 0),
      });

      return syncedPositions;
    } catch (error) {
      logger.error('Failed to sync DeFi positions', {
        walletId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to sync DeFi positions', 500);
    }
  }

  /**
   * Batch upsert positions with transaction safety
   */
  private async batchUpsertPositions(
    walletId: string,
    positions: DeFiPositionCreateInput[]
  ): Promise<DeFiPosition[]> {
    return await prisma.$transaction(async (tx) => {
      const upsertedPositions: DeFiPosition[] = [];

      // Mark existing Zapper positions as potentially stale
      await tx.deFiPosition.updateMany({
        where: {
          walletId,
          syncSource: 'zapper',
        },
        data: {
          isActive: false,
          lastSyncAt: new Date(),
        },
      });

      // Upsert new/updated positions
      for (const position of positions) {
        const upserted = await tx.deFiPosition.upsert({
          where: {
            walletId_contractAddress_network_syncSource: {
              walletId: position.walletId,
              contractAddress: position.contractAddress,
              network: position.network,
              syncSource: 'zapper',
            },
          },
          update: {
            ...position,
            isActive: true,
            lastSyncAt: new Date(),
            updatedAt: new Date(),
          },
          create: position,
        });

        upsertedPositions.push(upserted);
      }

      // Clean up positions that weren't updated (truly stale)
      const staleCutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago

      await tx.deFiPosition.deleteMany({
        where: {
          walletId,
          syncSource: 'zapper',
          isActive: false,
          lastSyncAt: {
            lt: staleCutoff,
          },
        },
      });

      logger.info('DeFi positions batch upsert completed', {
        walletId,
        upserted: upsertedPositions.length,
        cleanupCutoff: staleCutoff.toISOString(),
      });

      return upsertedPositions;
    });
  }

  /**
   * Get DeFi positions for a wallet with filters
   */
  async getWalletDeFiPositions(
    userId: string,
    walletId: string,
    filters: DeFiPositionFilters = {}
  ): Promise<DeFiPositionWithWallet[]> {
    try {
      // Verify wallet ownership
      const wallet = await prisma.cryptoWallet.findFirst({
        where: {
          id: walletId,
          userId,
        },
      });

      if (!wallet) {
        throw new AppError('Wallet not found or access denied', 404);
      }

      // Build where clause
      const where: any = {
        walletId,
        ...(filters.protocolName && { protocolName: filters.protocolName }),
        ...(filters.protocolType && { protocolType: filters.protocolType }),
        ...(filters.positionType && { positionType: filters.positionType }),
        ...(filters.network && { network: filters.network }),
        ...(filters.metaType && { metaType: filters.metaType }),
        ...(filters.isActive !== undefined && { isActive: filters.isActive }),
        ...(filters.minValueUsd && {
          totalValueUsd: { gte: filters.minValueUsd },
        }),
        ...(filters.maxValueUsd && {
          totalValueUsd: { lte: filters.maxValueUsd },
        }),
      };

      // Add range filter if both min and max provided
      if (filters.minValueUsd && filters.maxValueUsd) {
        where.totalValueUsd = {
          gte: filters.minValueUsd,
          lte: filters.maxValueUsd,
        };
      }

      const positions = await prisma.deFiPosition.findMany({
        where,
        include: {
          wallet: {
            select: {
              id: true,
              address: true,
              name: true,
              network: true,
            },
          },
        },
        orderBy: [{ totalValueUsd: 'desc' }, { createdAt: 'desc' }],
      });

      return positions;
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Failed to get wallet DeFi positions', {
        userId,
        walletId,
        filters,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new AppError('Failed to fetch DeFi positions', 500);
    }
  }

  /**
   * Get DeFi analytics for a wallet
   */
  async getDeFiAnalytics(userId: string, walletId: string): Promise<DeFiAnalytics> {
    try {
      // Get all positions for the wallet
      const positions = await this.getWalletDeFiPositions(userId, walletId);

      if (positions.length === 0) {
        return this.getEmptyAnalytics();
      }

      // Calculate summary metrics
      const totalValueUsd = positions.reduce((sum, pos) => sum + Number(pos.totalValueUsd), 0);
      const totalYieldEarned = positions.reduce(
        (sum, pos) => sum + Number(pos.yieldEarnedUsd || 0),
        0
      );
      const activePositions = positions.filter((pos) => pos.isActive).length;
      const protocolCount = new Set(positions.map((pos) => pos.protocolName)).size;

      // Calculate weighted average APY
      const avgAPY = this.calculateWeightedAverage(
        positions.filter((pos) => pos.apy),
        'apy',
        'totalValueUsd'
      );

      // Group positions
      const positionsByType = this.groupByAndCount(positions, 'positionType');
      const positionsByProtocol = this.groupByAndCount(positions, 'protocolName');
      const positionsByMetaType = this.groupByAndCount(
        positions.filter((pos) => pos.metaType),
        'metaType'
      );

      // Calculate protocol breakdown
      const protocolBreakdown = this.calculateProtocolBreakdown(positions);

      // Calculate risk metrics
      const riskMetrics = this.calculateRiskMetrics(positions);

      // Extract claimable rewards (simplified)
      const claimableRewards = positions
        .filter((pos) => pos.metaType === 'CLAIMABLE')
        .map((pos) => ({
          protocolName: pos.protocolName,
          amount: Number(pos.yieldEarned || 0),
          amountUsd: Number(pos.totalValueUsd),
          token: {
            symbol:
              pos.assets &&
              typeof pos.assets === 'object' &&
              'tokens' in pos.assets &&
              Array.isArray(pos.assets['tokens']) &&
              pos.assets['tokens'][0] &&
              typeof pos.assets['tokens'][0] === 'object' &&
              'symbol' in pos.assets['tokens'][0]
                ? String(pos.assets['tokens'][0]['symbol'])
                : 'UNKNOWN',
            address: pos.contractAddress,
          },
        }));

      // Extract LP positions (simplified)
      const lpPositions = positions
        .filter((pos) => pos.positionType === 'LP_TOKEN')
        .map((pos) => ({
          protocolName: pos.protocolName,
          poolName: pos.poolName || 'Unknown Pool',
          totalValueUsd: Number(pos.totalValueUsd),
          tokens:
            pos.assets &&
            typeof pos.assets === 'object' &&
            'tokens' in pos.assets &&
            Array.isArray(pos.assets['tokens'])
              ? pos.assets['tokens'].map((token: any) => ({
                  symbol: token.symbol,
                  balance: token.balance,
                  balanceUsd: token.balanceUSD,
                }))
              : [],
        }));

      const summary: DeFiPortfolioSummary = {
        totalValueUsd,
        totalYieldEarned,
        activePositions,
        protocolCount,
        avgAPY,
        positionsByType,
        positionsByProtocol,
        positionsByMetaType,
        netWorth: {
          totalSupplied: this.calculateSuppliedValue(positions),
          totalBorrowed: this.calculateBorrowedValue(positions),
          netWorth: totalValueUsd,
          healthRatio: this.calculateHealthRatio(positions),
        },
      };

      return {
        summary,
        claimableRewards,
        lpPositions,
        protocolBreakdown,
        riskMetrics,
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

  /**
   * Update position metrics (for manual updates or external data)
   */
  async updatePositionMetrics(
    userId: string,
    positionId: string,
    updates: {
      apr?: number;
      apy?: number;
      yieldEarnedUsd?: number;
    }
  ): Promise<DeFiPosition> {
    try {
      // Verify position ownership
      const position = await prisma.deFiPosition.findFirst({
        where: {
          id: positionId,
          wallet: {
            userId,
          },
        },
      });

      if (!position) {
        throw new AppError('Position not found or access denied', 404);
      }

      const updated = await prisma.deFiPosition.update({
        where: { id: positionId },
        data: {
          ...updates,
          updatedAt: new Date(),
        },
      });

      logger.info('Position metrics updated', {
        userId,
        positionId,
        updates,
      });

      return updated;
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Failed to update position metrics', {
        userId,
        positionId,
        updates,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new AppError('Failed to update position metrics', 500);
    }
  }

  // ===============================
  // PRIVATE HELPER METHODS
  // ===============================

  private getEmptyAnalytics(): DeFiAnalytics {
    return {
      summary: {
        totalValueUsd: 0,
        totalYieldEarned: 0,
        activePositions: 0,
        protocolCount: 0,
        avgAPY: 0,
        positionsByType: {},
        positionsByProtocol: {},
        positionsByMetaType: {},
        netWorth: {
          totalSupplied: 0,
          totalBorrowed: 0,
          netWorth: 0,
          healthRatio: null,
        },
      },
      claimableRewards: [],
      lpPositions: [],
      protocolBreakdown: {},
      riskMetrics: {
        diversificationScore: 0,
        protocolRiskScore: 0,
        liquidityScore: 0,
        overallRiskScore: 0,
      },
    };
  }

  private calculateWeightedAverage(
    positions: DeFiPosition[],
    field: keyof DeFiPosition,
    weightField: keyof DeFiPosition
  ): number {
    const totalWeight = positions.reduce((sum, pos) => {
      return sum + Number(pos[weightField] || 0);
    }, 0);

    if (totalWeight === 0) return 0;

    const weightedSum = positions.reduce((sum, pos) => {
      const value = Number(pos[field] || 0);
      const weight = Number(pos[weightField] || 0);
      return sum + value * weight;
    }, 0);

    return weightedSum / totalWeight;
  }

  private groupByAndCount(
    positions: DeFiPosition[],
    field: keyof DeFiPosition
  ): Record<string, number> {
    return positions.reduce(
      (acc, pos) => {
        const key = String(pos[field] || 'Unknown');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  private calculateProtocolBreakdown(positions: DeFiPosition[]): Record<string, any> {
    const breakdown: Record<string, any> = {};

    for (const position of positions) {
      const protocol = position.protocolName;

      if (!breakdown[protocol]) {
        breakdown[protocol] = {
          totalValueUsd: 0,
          positionCount: 0,
          apyValues: [] as number[],
        };
      }

      breakdown[protocol].totalValueUsd += Number(position.totalValueUsd);
      breakdown[protocol].positionCount += 1;

      if (position.apy) {
        breakdown[protocol].apyValues.push(Number(position.apy));
      }
    }

    // Calculate average APY for each protocol
    Object.keys(breakdown).forEach((protocol) => {
      const apyValues = breakdown[protocol].apyValues;
      breakdown[protocol].avgAPY =
        apyValues.length > 0
          ? apyValues.reduce((sum: number, apy: number) => sum + apy, 0) / apyValues.length
          : undefined;
      delete breakdown[protocol].apyValues;
    });

    return breakdown;
  }

  private calculateRiskMetrics(positions: DeFiPosition[]): DeFiAnalytics['riskMetrics'] {
    const totalValue = positions.reduce((sum, pos) => sum + Number(pos.totalValueUsd), 0);

    if (totalValue === 0) {
      return {
        diversificationScore: 0,
        protocolRiskScore: 0,
        liquidityScore: 0,
        overallRiskScore: 0,
      };
    }

    // Diversification score based on protocol distribution
    const protocolValues = Object.values(this.calculateProtocolBreakdown(positions)).map(
      (breakdown: any) => breakdown.totalValueUsd
    );

    const diversificationScore = this.calculateHerfindahlIndex(protocolValues, totalValue);

    // Protocol risk score (simplified - based on known protocols)
    const protocolRiskScore = this.calculateProtocolRisk(positions);

    // Liquidity score (simplified - based on position types)
    const liquidityScore = this.calculateLiquidityScore(positions);

    // Overall risk score (weighted average)
    const overallRiskScore =
      diversificationScore * 0.4 + protocolRiskScore * 0.4 + liquidityScore * 0.2;

    return {
      diversificationScore: Math.round(diversificationScore),
      protocolRiskScore: Math.round(protocolRiskScore),
      liquidityScore: Math.round(liquidityScore),
      overallRiskScore: Math.round(overallRiskScore),
    };
  }

  private calculateHerfindahlIndex(values: number[], total: number): number {
    const hhi = values.reduce((sum, value) => {
      const share = value / total;
      return sum + share * share;
    }, 0);

    // Convert to diversification score (inverse of HHI, scaled 0-100)
    return Math.max(0, (1 - hhi) * 100);
  }

  private calculateProtocolRisk(positions: DeFiPosition[]): number {
    // Simplified protocol risk scoring
    const riskScores: Record<string, number> = {
      AAVE: 20,
      Compound: 25,
      Uniswap: 30,
      Curve: 35,
      SushiSwap: 40,
      PancakeSwap: 45,
      // Default for unknown protocols
      Unknown: 70,
    };

    const totalValue = positions.reduce((sum, pos) => sum + Number(pos.totalValueUsd), 0);

    if (totalValue === 0) return 100;

    const weightedRisk = positions.reduce((sum, pos) => {
      const protocolRisk = riskScores[pos.protocolName] || riskScores['Unknown'] || 50;
      const weight = Number(pos.totalValueUsd) / totalValue;
      return sum + protocolRisk * weight;
    }, 0);

    return 100 - weightedRisk; // Invert so higher score = lower risk
  }

  private calculateLiquidityScore(positions: DeFiPosition[]): number {
    // Simplified liquidity scoring based on position types
    const liquidityScores: Record<string, number> = {
      LP_TOKEN: 60, // Moderate liquidity
      CONTRACT_POSITION: 80, // Good liquidity
      NFT_POSITION: 20, // Low liquidity
      OTHER: 50, // Unknown liquidity
    };

    const totalValue = positions.reduce((sum, pos) => sum + Number(pos.totalValueUsd), 0);

    if (totalValue === 0) return 0;

    const weightedLiquidity = positions.reduce((sum, pos) => {
      const liquidityScore = liquidityScores[pos.positionType] || liquidityScores['OTHER'] || 50;
      const weight = Number(pos.totalValueUsd) / totalValue;
      return sum + liquidityScore * weight;
    }, 0);

    return weightedLiquidity;
  }

  private calculateSuppliedValue(positions: DeFiPosition[]): number {
    return positions
      .filter((pos) => pos.metaType === 'SUPPLIED')
      .reduce((sum, pos) => sum + Number(pos.totalValueUsd), 0);
  }

  private calculateBorrowedValue(positions: DeFiPosition[]): number {
    return positions
      .filter((pos) => pos.metaType === 'BORROWED')
      .reduce((sum, pos) => sum + Number(pos.totalValueUsd), 0);
  }

  private calculateHealthRatio(positions: DeFiPosition[]): number | null {
    const supplied = this.calculateSuppliedValue(positions);
    const borrowed = this.calculateBorrowedValue(positions);

    if (borrowed === 0) return null;
    return supplied / borrowed;
  }
}

// Export singleton instance
export const defiPositionService = new DeFiPositionService();
