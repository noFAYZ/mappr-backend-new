/**
 * Type-Safe App Balances Parser for PortfolioV2 GraphQL Response
 * Handles nested token structures, contract positions, and claimables
 */

// Core types for the GraphQL response structure
export interface NetworkObject {
  name: string;
  slug: string;
  chainId: number;
  evmCompatible?: boolean;
}

export interface App {
  displayName: string;
  slug: string;
  url?: string;
  imgUrl?: string;
  description?: string;
  category?: {
    name: string;
  };
}

export interface DisplayProps {
  label?: string;
  images?: string[];
  balanceDisplayMode?: string | null;
}

// Token types
export type MetaType =
  | 'SUPPLIED'
  | 'BORROWED'
  | 'CLAIMABLE'
  | 'VESTING'
  | 'LOCKED'
  | 'NFT'
  | 'WALLET';
export type TokenType = 'base-token' | 'app-token' | 'contract-position' | 'non-fungible';
export type NetworkString =
  | 'ETHEREUM_MAINNET'
  | 'BASE_MAINNET'
  | 'POLYGON_MAINNET'
  | 'ARBITRUM_MAINNET'
  | string;

export interface BaseToken {
  type: TokenType;
  address: string;
  network: NetworkString;
  balance: number;
  balanceUSD: number;
  price: number;
  symbol: string;
  decimals: number;
  level: number;

}

export interface AppToken extends BaseToken {
  type: 'app-token';
  appId?: string | undefined;
  supply?: number | undefined;
  pricePerShare?: number | number[] | undefined;
  groupId?: string | undefined;
  groupLabel?: string | undefined;
  underlyingTokens?: ParsedToken[] | undefined;
}

export interface ContractToken extends BaseToken {
  metaType: MetaType;
  underlyingTokens?: ParsedToken[] | undefined;
}

export type ParsedToken = BaseToken | AppToken | ContractToken;

// Position types
export interface BasePosition {
  type: TokenType;
  address: string;
  network: NetworkString;
  balanceUSD: number;
  positionType: 'app-token' | 'contract-position' | 'non-fungible';
}

export interface AppTokenPosition extends BasePosition {
  positionType: 'app-token';
  symbol: string;
  decimals: number;
  balance: number;
  price: number;
  appId?: string | undefined;
  groupId?: string | undefined;
  groupLabel?: string | undefined;
  supply?: number | undefined;
  pricePerShare?: number | number[] | undefined;
  tokens: ParsedToken[];
  displayProps: DisplayProps;
}

export interface ContractPosition extends BasePosition {
  positionType: 'contract-position';
  appId?: string | undefined;
  groupId?: string | undefined;
  groupLabel?: string | undefined;
  tokens: ContractToken[];
  displayProps: DisplayProps;
}

export interface NonFungiblePosition extends BasePosition {
  positionType: 'non-fungible';
  symbol?: string;
  decimals?: number;
  balance: number;
  price: number;
}

export type ParsedPosition = AppTokenPosition | ContractPosition | NonFungiblePosition;

// App structure
export interface ParsedApp {
  displayName: string;
  slug?: string | undefined;
  url?: string | undefined;
  imgUrl?: string | undefined;
  description?: string | undefined;
  category?: string | undefined;
  network: NetworkObject;
  balanceUSD: number;
  positions: ParsedPosition[];
}

// Network and meta type aggregations
export interface NetworkBalance {
  network: NetworkObject;
  balanceUSD: number;
  appCount?: number | undefined;
}

export interface MetaTypeBalance {
  metaType: MetaType;
  positionCount: number;
  balanceUSD: number;
}

export interface AccountBalance {
  accountAddress: string;
  balanceUSD: number;
  appCount?: number | undefined;
}

// Main parsed structure
export interface ParsedAppBalances {
  totalBalanceUSD: number;
  totalApps?: number | undefined;
  apps: ParsedApp[];
  byNetwork: NetworkBalance[];
  byMetaType: MetaTypeBalance[];
  byAccount: AccountBalance[];
}

// GraphQL response types (input) - matching the actual schema
interface BaseTokenPositionBalance {
  type: 'base-token';
  address: string;
  network: NetworkString;
  balance: string;
  balanceUSD: number;
  price: number;
  symbol: string;
  decimals: number;
  imageUrlV2?: string;
}

interface AppTokenPositionBalance {
  type: 'app-token';
  address: string;
  network: NetworkString;
  symbol: string;
  decimals: number;
  balance: string;
  balanceUSD: number;
  price: number;
  appId: string;
  groupId?: string;
  groupLabel?: string;
  supply: number;
  pricePerShare: number[];
  imageUrlV2?: string;
  tokens?: Array<BaseTokenPositionBalance | AppTokenPositionBalance>;
}

interface NonFungiblePositionBalance {
  type: 'non-fungible';
  address: string;
  network: NetworkString;
  balance: string;
  balanceUSD: number;
  price: number;
  symbol: string;
  decimals: number;
  imageUrlV2?: string;
}

type AbstractToken =
  | BaseTokenPositionBalance
  | AppTokenPositionBalance
  | NonFungiblePositionBalance;

interface TokenWithMetaType {
  metaType: string;
  token: AbstractToken;
}

interface AppTokenPositionBalanceGQL extends AppTokenPositionBalance {
  displayProps?: DisplayProps;
}

interface ContractPositionBalanceGQL {
  type: 'contract-position';
  address: string;
  network: NetworkString;
  appId: string;
  groupId?: string;
  groupLabel?: string;
  balanceUSD: number;
  tokens: TokenWithMetaType[];
  displayProps?: DisplayProps;
}

export type GraphQLPosition = AppTokenPositionBalanceGQL | ContractPositionBalanceGQL;

interface GraphQLAppNode {
  balanceUSD: number;
  app: App;
  network: NetworkObject;
  positionBalances?: {
    edges: Array<{ node: GraphQLPosition }>;
  };
  // Alternative field name that might be used in some queries
  balances?: {
    edges: Array<{ node: GraphQLPosition }>;
  };
}

interface GraphQLAppBalances {
  totalBalanceUSD: number;
  byApp?: {
    totalCount: number;
    edges: Array<{ node: GraphQLAppNode }>;
  };
  byNetwork?: {
    edges: Array<{
      node: {
        network: NetworkObject;
        balanceUSD: number;
        appCount?: number;
      };
    }>;
  };
  byMetaType?: {
    edges: Array<{
      node: {
        metaType: string;
        positionCount: number;
        balanceUSD: number;
      };
    }>;
  };
  byAccount?: {
    edges: Array<{
      node: {
        accountAddress: string;
        balanceUSD: number;
        appCount?: number;
      };
    }>;
  };
}

export interface GraphQLResponse {
  portfolioV2?: {
    appBalances?: GraphQLAppBalances;
  };
}

// Utility functions
function isValidMetaType(type: string): type is MetaType {
  return ['SUPPLIED', 'BORROWED', 'CLAIMABLE', 'VESTING', 'LOCKED', 'NFT', 'WALLET'].includes(type);
}

function parseFloat(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseFloat(value);
  return 0;
}

// Helper function to recursively parse token structures
function parseTokens(
  tokens: AbstractToken[] | undefined,
  level: number = 1,
  maxLevel: number = 3
): ParsedToken[] {
  if (!tokens || level > maxLevel) return [];

  return tokens.map((token) => {
    const baseFields: BaseToken = {
      type: token.type as TokenType,
      address: token.address,
      network: token.network as NetworkString,
      balance: parseFloat(token.balance),
      balanceUSD: token.balanceUSD,
      price: token.price,
      symbol: token.symbol,
      decimals: token.decimals,
      level: level,
      ...(token.imageUrlV2 && { imageUrlV2: token.imageUrlV2 }),
    };

    // Handle app tokens
    if (token.type === 'app-token') {
      const appTokenData = token as AppTokenPositionBalance;
      const appToken: AppToken = {
        ...baseFields,
        type: 'app-token',
        appId: appTokenData.appId,
        supply: appTokenData.supply,
        pricePerShare: appTokenData.pricePerShare,
        ...(appTokenData.groupId !== undefined && { groupId: appTokenData.groupId }),
        ...(appTokenData.groupLabel !== undefined && { groupLabel: appTokenData.groupLabel }),
        ...(level < maxLevel &&
          appTokenData.tokens && {
            underlyingTokens: parseTokens(appTokenData.tokens, level + 1, maxLevel),
          }),
      };
      return appToken;
    }

    // For app tokens with nested tokens, add underlying tokens
    if ('tokens' in token && token.tokens && Array.isArray(token.tokens) && level < maxLevel) {
      return {
        ...baseFields,
        underlyingTokens: parseTokens(token.tokens as AbstractToken[], level + 1, maxLevel),
      } as ParsedToken;
    }

    return baseFields;
  });
}

// Parse contract position tokens (with metaType)
function parseContractTokens(
  tokens: TokenWithMetaType[] | undefined,
  level: number = 1,
  maxLevel: number = 3
): ContractToken[] {
  if (!tokens || level > maxLevel) return [];

  return tokens.map((tokenWrapper) => {
    const token = tokenWrapper.token;
    const baseToken = parseTokens([token], level, maxLevel)[0];

    if (!baseToken) {
      throw new Error('Failed to parse base token');
    }

    const contractToken: ContractToken = {
      ...baseToken,
      metaType: isValidMetaType(tokenWrapper.metaType) ? tokenWrapper.metaType : 'SUPPLIED',
    };

    return contractToken;
  });
}

// Parse individual position balance
function parsePositionBalance(position: GraphQLPosition): ParsedPosition {
  const basePosition = {
    type: position.type as TokenType,
    address: position.address,
    network: position.network as NetworkString,
    balanceUSD: position.balanceUSD,
  };

  if (position.type === 'app-token') {
    const appPosition = position as AppTokenPositionBalanceGQL;
    const appTokenPosition: AppTokenPosition = {
      ...basePosition,
      positionType: 'app-token',
      symbol: appPosition.symbol,
      decimals: appPosition.decimals,
      balance: parseFloat(appPosition.balance),
      price: appPosition.price,
      appId: appPosition.appId,
      ...(appPosition.groupId !== undefined && { groupId: appPosition.groupId }),
      ...(appPosition.groupLabel !== undefined && { groupLabel: appPosition.groupLabel }),
      supply: appPosition.supply,
      pricePerShare: appPosition.pricePerShare,
      tokens: parseTokens(appPosition.tokens),
      displayProps: appPosition.displayProps || {},
    };
    return appTokenPosition;
  }

  if (position.type === 'contract-position') {
    const contractPos = position as ContractPositionBalanceGQL;
    const contractPosition: ContractPosition = {
      ...basePosition,
      positionType: 'contract-position',
      appId: contractPos.appId,
      ...(contractPos.groupId !== undefined && { groupId: contractPos.groupId }),
      ...(contractPos.groupLabel !== undefined && { groupLabel: contractPos.groupLabel }),
      tokens: parseContractTokens(contractPos.tokens),
      displayProps: contractPos.displayProps || {},
    };
    return contractPosition;
  }

  // Default fallback (should not happen with correct types)
  return {
    ...basePosition,
    positionType: 'app-token',
    symbol: '',
    decimals: 18,
    balance: 0,
    price: 0,
    tokens: [],
    displayProps: {},
  } as AppTokenPosition;
}

// Main app balances parser function
export function parseAppBalances(portfolioV2Response: GraphQLResponse): ParsedAppBalances {
  const appBalances = portfolioV2Response?.portfolioV2?.appBalances;

  if (!appBalances) {
    throw new Error('Invalid portfolioV2 response structure - appBalances not found');
  }

  const parsed: ParsedAppBalances = {
    totalBalanceUSD: appBalances.totalBalanceUSD,
    apps: [],
    byNetwork: [],
    byMetaType: [],
    byAccount: [],
  };

  // Parse by app view
  if (appBalances.byApp?.edges) {
    parsed.totalApps = appBalances.byApp.totalCount;
    parsed.apps = appBalances.byApp.edges.map((edge) => {
      const app = edge.node;

      const parsedApp: ParsedApp = {
        displayName: app.app.displayName,
        ...(app.app.slug !== undefined && { slug: app.app.slug }),
        ...(app.app.url !== undefined && { url: app.app.url }),
        ...(app.app.imgUrl !== undefined && { imgUrl: app.app.imgUrl }),
        ...(app.app.description !== undefined && { description: app.app.description }),
        ...(app.app.category?.name !== undefined && { category: app.app.category.name }),
        network: app.network,
        balanceUSD: app.balanceUSD,
        positions: (app.positionBalances?.edges || app.balances?.edges || []).map((posEdge) =>
          parsePositionBalance(posEdge.node)
        ),
      };

      return parsedApp;
    });
  }

  // Parse by network view
  if (appBalances.byNetwork?.edges) {
    parsed.byNetwork = appBalances.byNetwork.edges.map((edge) => ({
      network: edge.node.network,
      balanceUSD: edge.node.balanceUSD,
      ...(edge.node.appCount !== undefined && { appCount: edge.node.appCount }),
    }));
  }

  // Parse by meta type view
  if (appBalances.byMetaType?.edges) {
    parsed.byMetaType = appBalances.byMetaType.edges.map((edge) => ({
      metaType: isValidMetaType(edge.node.metaType) ? edge.node.metaType : 'SUPPLIED',
      positionCount: edge.node.positionCount,
      balanceUSD: edge.node.balanceUSD,
    }));
  }

  // Parse by account view
  if (appBalances.byAccount?.edges) {
    parsed.byAccount = appBalances.byAccount.edges.map((edge) => ({
      accountAddress: edge.node.accountAddress,
      balanceUSD: edge.node.balanceUSD,
      ...(edge.node.appCount !== undefined && { appCount: edge.node.appCount }),
    }));
  }

  return parsed;
}

// Utility interfaces for extracted data
export interface ClaimableToken extends ContractToken {
  metaType: 'CLAIMABLE';
  appName: string;
  appSlug?: string | undefined;
  networkObject: NetworkObject;
  positionAddress: string;
  displayProps?: DisplayProps | undefined;
}

export interface SuppliedToken extends ContractToken {
  metaType: 'SUPPLIED';
  appName: string;
  networkObject: NetworkObject;
  positionAddress: string;
}

export interface BorrowedToken extends ContractToken {
  metaType: 'BORROWED';
  appName: string;
  networkObject: NetworkObject;
  positionAddress: string;
}

export interface LPPosition extends AppTokenPosition {
  appName: string;
  networkObject: NetworkObject;
}

export interface ProtocolPosition {
  totalBalanceUSD: number;
  network: NetworkObject;
  category?: string | undefined;
  positions: ParsedPosition[];
  positionCount: number;
}

export interface NetWorthCalculation {
  totalSupplied: number;
  totalBorrowed: number;
  netWorth: number;
  healthRatio: number | null;
}

// Type-safe utility functions
export function getClaimableTokens(parsedAppBalances: ParsedAppBalances): ClaimableToken[] {
  const claimables: ClaimableToken[] = [];

  parsedAppBalances.apps.forEach((app) => {
    app.positions.forEach((position) => {
      if (position.positionType === 'contract-position') {
        position.tokens.forEach((token) => {
          if (token.metaType === 'CLAIMABLE' && token.balanceUSD > 0) {
            claimables.push({
              ...token,
              metaType: 'CLAIMABLE',
              appName: app.displayName,
              ...(app.slug !== undefined && { appSlug: app.slug }),
              networkObject: app.network,
              positionAddress: position.address,
              ...(position.displayProps !== undefined && { displayProps: position.displayProps }),
            });
          }
        });
      }
    });
  });

  return claimables.sort((a, b) => b.balanceUSD - a.balanceUSD);
}

export function getSuppliedTokens(parsedAppBalances: ParsedAppBalances): SuppliedToken[] {
  const supplied: SuppliedToken[] = [];

  parsedAppBalances.apps.forEach((app) => {
    app.positions.forEach((position) => {
      if (position.positionType === 'contract-position') {
        position.tokens.forEach((token) => {
          if (token.metaType === 'SUPPLIED' && token.balanceUSD > 0) {
            supplied.push({
              ...token,
              metaType: 'SUPPLIED',
              appName: app.displayName,
              networkObject: app.network,
              positionAddress: position.address,
            });
          }
        });
      }
    });
  });

  return supplied.sort((a, b) => b.balanceUSD - a.balanceUSD);
}

export function getBorrowedTokens(parsedAppBalances: ParsedAppBalances): BorrowedToken[] {
  const borrowed: BorrowedToken[] = [];

  parsedAppBalances.apps.forEach((app) => {
    app.positions.forEach((position) => {
      if (position.positionType === 'contract-position') {
        position.tokens.forEach((token) => {
          if (token.metaType === 'BORROWED' && token.balanceUSD > 0) {
            borrowed.push({
              ...token,
              metaType: 'BORROWED',
              appName: app.displayName,
              networkObject: app.network,
              positionAddress: position.address,
            });
          }
        });
      }
    });
  });

  return borrowed.sort((a, b) => b.balanceUSD - a.balanceUSD);
}

export function getLPPositions(parsedAppBalances: ParsedAppBalances): LPPosition[] {
  const lpPositions: LPPosition[] = [];

  parsedAppBalances.apps.forEach((app) => {
    app.positions.forEach((position) => {
      if (
        position.positionType === 'app-token' &&
        (position.groupLabel?.toLowerCase().includes('pool') ||
          position.symbol?.includes('LP') ||
          position.tokens.length > 1)
      ) {
        lpPositions.push({
          ...position,
          appName: app.displayName,
          networkObject: app.network,
        });
      }
    });
  });

  return lpPositions.sort((a, b) => b.balanceUSD - a.balanceUSD);
}

export function getPositionsByProtocol(
  parsedAppBalances: ParsedAppBalances
): Record<string, ProtocolPosition> {
  const byProtocol: Record<string, ProtocolPosition> = {};

  parsedAppBalances.apps.forEach((app) => {
    byProtocol[app.displayName] = {
      totalBalanceUSD: app.balanceUSD,
      network: app.network,
      ...(app.category !== undefined && { category: app.category }),
      positions: app.positions,
      positionCount: app.positions.length,
    };
  });

  return byProtocol;
}

export function calculateNetWorth(parsedAppBalances: ParsedAppBalances): NetWorthCalculation {
  const supplied = getSuppliedTokens(parsedAppBalances);
  const borrowed = getBorrowedTokens(parsedAppBalances);

  const totalSupplied = supplied.reduce((sum, token) => sum + token.balanceUSD, 0);
  const totalBorrowed = borrowed.reduce((sum, token) => sum + token.balanceUSD, 0);

  return {
    totalSupplied,
    totalBorrowed,
    netWorth: totalSupplied - totalBorrowed,
    healthRatio: totalBorrowed > 0 ? totalSupplied / totalBorrowed : null,
  };
}

export function getAllTokensFlat(
  parsedAppBalances: ParsedAppBalances
): Array<ParsedToken & { appName: string; networkObject: NetworkObject }> {
  const allTokens: Array<ParsedToken & { appName: string; networkObject: NetworkObject }> = [];

  function extractTokens(tokens: ParsedToken[], appContext: ParsedApp): void {
    tokens.forEach((token) => {
      allTokens.push({
        ...token,
        appName: appContext.displayName,
        networkObject: appContext.network,
      });

      if ('underlyingTokens' in token && token.underlyingTokens) {
        extractTokens(token.underlyingTokens, appContext);
      }
    });
  }

  parsedAppBalances.apps.forEach((app) => {
    app.positions.forEach((position) => {
      if (position.positionType === 'app-token') {
        extractTokens(position.tokens, app);
      } else if (position.positionType === 'contract-position') {
        extractTokens(position.tokens, app);
      }
    });
  });

  return allTokens;
}
