/**
 * ZapperDeFiMapper - Transform Zapper parsed data to DeFi position database format
 */
import { BlockchainNetwork } from '@prisma/client';
import { ParsedApp, ParsedPosition, ParsedAppBalances, NetworkObject } from '@/utils/zapper/appBalanceParser';

export interface DeFiPositionCreateInput {
  walletId: string;
  protocolName: string;
  protocolType: string;
  contractAddress: string;
  network: BlockchainNetwork;
  positionType: string;
  poolName?: string;
  totalValueUsd: number;
  principalUsd?: number;
  yieldEarned?: number;
  yieldEarnedUsd?: number;
  apr?: number;
  apy?: number;
  dailyYield?: number;
  totalReturn?: number;
  totalReturnPct?: number;
  assets?: any;
  isActive: boolean;
  canWithdraw: boolean;
  lockupEnd?: Date;
  positionData?: any;
  lastYieldClaim?: Date;

  // Zapper-specific fields
  zapperAppId?: string;
  zapperGroupId?: string;
  zapperPositionAddress?: string;
  metaType?: string;
  underlyingTokens?: any;
  displayProps?: any;
  syncSource: string;
  externalPositionId?: string;
  lastSyncAt: Date;
}

export interface DeFiPortfolioSummary {
  totalValueUsd: number;
  totalYieldEarned: number;
  activePositions: number;
  protocolCount: number;
  avgAPY: number;
  positionsByType: Record<string, number>;
  positionsByProtocol: Record<string, number>;
  positionsByMetaType: Record<string, number>;
  netWorth: {
    totalSupplied: number;
    totalBorrowed: number;
    netWorth: number;
    healthRatio: number | null;
  };
}

export class ZapperDeFiMapper {

  /**
   * Maps a ParsedApp and its positions to DeFiPosition database records
   */
  mapParsedAppToPositions(
    walletId: string,
    app: ParsedApp
  ): DeFiPositionCreateInput[] {
    const positions: DeFiPositionCreateInput[] = [];

    for (const position of app.positions) {
      const mapped = this.mapParsedPositionToDbRecord(walletId, app, position);
      positions.push(mapped);
    }

    return positions;
  }

  /**
   * Maps a single position to database format
   */
  private mapParsedPositionToDbRecord(
    walletId: string,
    app: ParsedApp,
    position: ParsedPosition
  ): DeFiPositionCreateInput {

    const protocolType = this.inferProtocolType(app.category, position.positionType);
    const positionType = this.mapPositionType(position.positionType);
    const poolName = this.extractPoolName(position);
    const metaType = this.extractMetaType(position);

    const data: any = {
      walletId,
      protocolName: app.displayName,
      protocolType,
      contractAddress: position.address,
      network: this.mapNetworkToBlockchainNetwork(app.network),
      positionType,
      totalValueUsd: position.balanceUSD,
      isActive: position.balanceUSD > 0,
      canWithdraw: this.determineWithdrawability(position),
      syncSource: 'zapper',
      lastSyncAt: new Date(),
    };

    // Add optional fields only if they have valid values
    if (poolName) data.poolName = poolName;
    if (metaType) data.metaType = metaType;

    const principalUsd = this.calculatePrincipal(position);
    if (principalUsd !== null) data.principalUsd = principalUsd;

    const yieldEarned = this.calculateYieldEarned(position);
    if (yieldEarned !== null) data.yieldEarned = yieldEarned;

    const yieldEarnedUsd = this.calculateYieldEarnedUsd(position);
    if (yieldEarnedUsd !== null) data.yieldEarnedUsd = yieldEarnedUsd;

    const apr = this.extractAPR(position);
    if (apr !== null) data.apr = apr;

    const apy = this.extractAPY(position);
    if (apy !== null) data.apy = apy;

    const assets = this.serializeAssets(position);
    if (assets !== null) data.assets = assets;

    const positionData = this.serializePositionData(position);
    if (positionData !== null) data.positionData = positionData;

    if (app.slug) data.zapperAppId = app.slug;

    const zapperGroupId = this.extractGroupId(position);
    if (zapperGroupId) data.zapperGroupId = zapperGroupId;

    data.zapperPositionAddress = position.address;

    const underlyingTokens = this.serializeUnderlyingTokens(position);
    if (underlyingTokens !== null) data.underlyingTokens = underlyingTokens;

    const displayProps = this.serializeDisplayProps(position);
    if (displayProps !== null) data.displayProps = displayProps;

    const externalPositionId = this.generatePositionId(app, position);
    if (externalPositionId) data.externalPositionId = externalPositionId;

    return data;
  }

  /**
   * Infers protocol type from category and position type
   */
  private inferProtocolType(category?: string, _positionType?: string): string {
    if (!category) return 'Other';

    const categoryLower = category.toLowerCase();

    // DEX protocols
    if (categoryLower.includes('dex') || categoryLower.includes('exchange')) {
      return 'DEX';
    }

    // Lending protocols
    if (categoryLower.includes('lending') || categoryLower.includes('borrow')) {
      return 'Lending';
    }

    // Yield farming
    if (categoryLower.includes('yield') || categoryLower.includes('farm')) {
      return 'Yield';
    }

    // Liquid staking
    if (categoryLower.includes('staking') || categoryLower.includes('stake')) {
      return 'Staking';
    }

    // Insurance
    if (categoryLower.includes('insurance')) {
      return 'Insurance';
    }

    // Derivatives
    if (categoryLower.includes('derivative') || categoryLower.includes('option')) {
      return 'Derivatives';
    }

    // Bridge
    if (categoryLower.includes('bridge')) {
      return 'Bridge';
    }

    // NFT marketplace
    if (categoryLower.includes('nft')) {
      return 'NFT';
    }

    return 'Other';
  }

  /**
   * Maps Zapper position type to our position type
   */
  private mapPositionType(zapperPositionType: string): string {
    switch (zapperPositionType) {
      case 'app-token':
        return 'LP_TOKEN';
      case 'contract-position':
        return 'CONTRACT_POSITION';
      case 'non-fungible':
        return 'NFT_POSITION';
      default:
        return 'OTHER';
    }
  }

  /**
   * Extracts pool name from position data
   */
  private extractPoolName(position: ParsedPosition): string | undefined {
    if (position.positionType === 'app-token') {
      return position.groupLabel || position.symbol;
    }

    if (position.positionType === 'contract-position') {
      return position.groupLabel || 'Contract Position';
    }

    return undefined;
  }

  /**
   * Extracts meta type from position tokens
   */
  private extractMetaType(position: ParsedPosition): string | undefined {
    if (position.positionType === 'contract-position') {
      // Get the most common meta type from tokens
      const metaTypes = position.tokens.map(token => token.metaType);
      const mostCommon = this.getMostCommonValue(metaTypes);
      return mostCommon;
    }

    return undefined;
  }

  /**
   * Maps Zapper network to Prisma BlockchainNetwork enum
   */
  private mapNetworkToBlockchainNetwork(network: NetworkObject): BlockchainNetwork {
    const networkName = network.name?.toLowerCase() || network.slug?.toLowerCase() || '';

    // Map based on chain ID first (most reliable)
    switch (network.chainId) {
      case 1: return BlockchainNetwork.ETHEREUM;
      case 137: return BlockchainNetwork.POLYGON;
      case 56: return BlockchainNetwork.BSC;
      case 42161: return BlockchainNetwork.ARBITRUM;
      case 10: return BlockchainNetwork.OPTIMISM;
      case 43114: return BlockchainNetwork.AVALANCHE;
      case 8453: return BlockchainNetwork.BASE;
      case 250: return BlockchainNetwork.FANTOM;
      case 25: return BlockchainNetwork.CRONOS;
      case 100: return BlockchainNetwork.GNOSIS;
      case 1313161554: return BlockchainNetwork.AURORA;
      case 42220: return BlockchainNetwork.CELO;
      default:
        // Fallback to name matching
        if (networkName.includes('ethereum')) return BlockchainNetwork.ETHEREUM;
        if (networkName.includes('polygon')) return BlockchainNetwork.POLYGON;
        if (networkName.includes('binance') || networkName.includes('bsc')) return BlockchainNetwork.BSC;
        if (networkName.includes('arbitrum')) return BlockchainNetwork.ARBITRUM;
        if (networkName.includes('optimism')) return BlockchainNetwork.OPTIMISM;
        if (networkName.includes('avalanche')) return BlockchainNetwork.AVALANCHE;
        if (networkName.includes('base')) return BlockchainNetwork.BASE;
        if (networkName.includes('fantom')) return BlockchainNetwork.FANTOM;

        // Default to Ethereum for unknown networks
        return BlockchainNetwork.ETHEREUM;
    }
  }

  /**
   * Calculate principal amount (initial investment)
   */
  private calculatePrincipal(position: ParsedPosition): number | undefined {
    // For now, assume total value is principal (can be enhanced with historical data)
    return position.balanceUSD;
  }

  /**
   * Calculate yield earned in native token
   */
  private calculateYieldEarned(_position: ParsedPosition): number | undefined {
    // This would require historical data or protocol-specific logic
    // For now, return undefined - can be enhanced later
    return undefined;
  }

  /**
   * Calculate yield earned in USD
   */
  private calculateYieldEarnedUsd(_position: ParsedPosition): number | undefined {
    // This would require historical data or protocol-specific logic
    // For now, return undefined - can be enhanced later
    return undefined;
  }

  /**
   * Extract APR from position data
   */
  private extractAPR(_position: ParsedPosition): number | undefined {
    // Zapper doesn't provide APR in the current schema
    // This could be enhanced by calling additional Zapper endpoints
    return undefined;
  }

  /**
   * Extract APY from position data
   */
  private extractAPY(_position: ParsedPosition): number | undefined {
    // Zapper doesn't provide APY in the current schema
    // This could be enhanced by calling additional Zapper endpoints
    return undefined;
  }

  /**
   * Serialize assets for JSON storage
   */
  private serializeAssets(position: ParsedPosition): any {
    if (position.positionType === 'app-token') {
      return {
        tokens: position.tokens.map(token => ({
          symbol: token.symbol,
          address: token.address,
          balance: token.balance,
          balanceUSD: token.balanceUSD,
          price: token.price,
          network: token.network,
        }))
      };
    }

    if (position.positionType === 'contract-position') {
      return {
        tokens: position.tokens.map(token => ({
          symbol: token.symbol,
          address: token.address,
          balance: token.balance,
          balanceUSD: token.balanceUSD,
          price: token.price,
          network: token.network,
          metaType: token.metaType,
        }))
      };
    }

    return null;
  }

  /**
   * Determine if position can be withdrawn
   */
  private determineWithdrawability(_position: ParsedPosition): boolean {
    // Most DeFi positions can be withdrawn unless they're locked
    // This logic can be enhanced based on protocol-specific rules
    return true;
  }

  /**
   * Serialize complete position data
   */
  private serializePositionData(position: ParsedPosition): any {
    return {
      positionType: position.positionType,
      address: position.address,
      network: position.network,
      balanceUSD: position.balanceUSD,
      ...('symbol' in position && { symbol: position.symbol }),
      ...('decimals' in position && { decimals: position.decimals }),
      ...('balance' in position && { balance: position.balance }),
      ...('price' in position && { price: position.price }),
      ...('supply' in position && { supply: position.supply }),
      ...('pricePerShare' in position && { pricePerShare: position.pricePerShare }),
    };
  }

  /**
   * Extract group ID from position
   */
  private extractGroupId(position: ParsedPosition): string | undefined {
    if ('groupId' in position) {
      return position.groupId;
    }
    return undefined;
  }

  /**
   * Serialize underlying tokens
   */
  private serializeUnderlyingTokens(position: ParsedPosition): any {
    // Only ContractPosition has tokens property
    if (position.positionType !== 'contract-position') {
      return null;
    }

    const contractPosition = position as any; // Type assertion since we checked positionType
    const tokens = contractPosition.tokens || [];

    return tokens.map((token: any) => ({
      symbol: token.symbol,
      address: token.address,
      balance: token.balance,
      balanceUSD: token.balanceUSD,
      price: token.price,
      decimals: token.decimals,
      level: token.level,
      type: token.type,
      network: token.network,
      ...('metaType' in token && { metaType: token.metaType }),
      ...('underlyingTokens' in token && token.underlyingTokens && {
        underlyingTokens: token.underlyingTokens
      }),
    }));
  }

  /**
   * Serialize display properties
   */
  private serializeDisplayProps(position: ParsedPosition): any {
    // Only ContractPosition has displayProps property
    if (position.positionType !== 'contract-position') {
      return null;
    }

    const contractPosition = position as any; // Type assertion since we checked positionType
    return contractPosition.displayProps || {};
  }

  /**
   * Generate unique position ID from app and position data
   */
  private generatePositionId(app: ParsedApp, position: ParsedPosition): string {
    const appSlug = app.slug || app.displayName.toLowerCase().replace(/\s+/g, '-');
    const networkSlug = app.network.slug || app.network.name.toLowerCase();
    const positionAddress = position.address;

    return `${appSlug}-${networkSlug}-${positionAddress}`;
  }

  /**
   * Get most common value from array
   */
  private getMostCommonValue(array: (string | undefined)[]): string | undefined {
    const counts = array.reduce((acc, val) => {
      if (val) {
        acc[val] = (acc[val] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    let mostCommon: string | undefined;
    let maxCount = 0;

    for (const [value, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = value;
      }
    }

    return mostCommon;
  }

  /**
   * Create portfolio summary from parsed app balances
   */
  createPortfolioSummary(
    parsedData: ParsedAppBalances,
    existingPositions: DeFiPositionCreateInput[]
  ): DeFiPortfolioSummary {

    const positionsByType = existingPositions.reduce((acc, pos) => {
      acc[pos.positionType] = (acc[pos.positionType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const positionsByProtocol = existingPositions.reduce((acc, pos) => {
      acc[pos.protocolName] = (acc[pos.protocolName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const positionsByMetaType = existingPositions.reduce((acc, pos) => {
      if (pos.metaType) {
        acc[pos.metaType] = (acc[pos.metaType] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    // Calculate weighted average APY
    const totalValue = existingPositions.reduce((sum, pos) => sum + pos.totalValueUsd, 0);
    const weightedAPY = existingPositions.reduce((sum, pos) => {
      if (pos.apy && pos.totalValueUsd > 0) {
        return sum + (pos.apy * (pos.totalValueUsd / totalValue));
      }
      return sum;
    }, 0);

    return {
      totalValueUsd: parsedData.totalBalanceUSD,
      totalYieldEarned: existingPositions.reduce((sum, pos) => sum + (pos.yieldEarnedUsd || 0), 0),
      activePositions: existingPositions.filter(pos => pos.isActive).length,
      protocolCount: Object.keys(positionsByProtocol).length,
      avgAPY: weightedAPY,
      positionsByType,
      positionsByProtocol,
      positionsByMetaType,
      netWorth: {
        totalSupplied: 0, // Will be calculated from token analysis
        totalBorrowed: 0, // Will be calculated from token analysis
        netWorth: parsedData.totalBalanceUSD,
        healthRatio: null,
      },
    };
  }
}

// Export singleton instance
export const zapperDeFiMapper = new ZapperDeFiMapper();