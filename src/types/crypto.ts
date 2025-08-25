import { WalletType, BlockchainNetwork, AssetType, TransactionType, TransactionStatus, NFTStandard } from '@prisma/client';

// ===============================
// CRYPTO SERVICE TYPES
// ===============================

export interface CryptoWalletRequest {
  name: string;
  address: string;
  type: WalletType;
  network: BlockchainNetwork;
  label?: string | undefined;
  notes?: string | undefined;
  tags?: string[] | undefined;
}

export interface UpdateWalletRequest {
  name?: string | undefined;
  label?: string | null | undefined;
  notes?: string | null | undefined;
  tags?: string[] | undefined;
  isActive?: boolean | undefined;
  isWatching?: boolean | undefined;
}

export interface PortfolioSummary {
  totalValueUsd: number;
  totalAssets: number;
  totalNfts: number;
  totalDeFiValue: number;
  dayChange: number;
  dayChangePct: number;
  topAssets: AssetBalance[];
  networkDistribution: NetworkAllocation[];
  assetTypeDistribution: AssetTypeAllocation[];
}

export interface AssetBalance {
  symbol: string;
  name: string;
  balance: string;
  balanceUsd: number;
  price: number;
  change24h: number;
  logoUrl?: string | null;
  contractAddress?: string | null;
  network: BlockchainNetwork;
}

export interface NetworkAllocation {
  network: BlockchainNetwork;
  valueUsd: number;
  percentage: number;
  assetCount: number;
}

export interface AssetTypeAllocation {
  type: AssetType;
  valueUsd: number;
  percentage: number;
  count: number;
}

export interface CryptoTransactionFilters {
  type?: TransactionType[] | undefined;
  status?: TransactionStatus[] | undefined;
  network?: BlockchainNetwork[] | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  minValue?: number | undefined;
  maxValue?: number | undefined;
  search?: string | undefined; // Search in description, hash, addresses
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface NFTFilters {
  collections?: string[] | undefined;
  network?: BlockchainNetwork[] | undefined;
  standard?: NFTStandard[] | undefined;
  hasPrice?: boolean | undefined;
  isSpam?: boolean | undefined;
  search?: string | undefined;
}

export interface DeFiPositionFilters {
  protocols?: string[] | undefined;
  types?: string[] | undefined;
  networks?: BlockchainNetwork[] | undefined;
  minValue?: number | undefined;
  isActive?: boolean | undefined;
}

// ===============================
// ZERION SDK RESPONSE TYPES
// ===============================

export interface ZerionWalletResponse {
  data: {
    type: 'wallets';
    id: string;
    attributes: {
      address: string;
      total: {
        value: string;
      };
      positions_distribution: {
        [network: string]: {
          total: {
            value: string;
          };
          positions: Array<{
            quantity: string;
            value: string;
            price: string;
            fungible: {
              name: string;
              symbol: string;
              icon?: {
                url: string;
              };
              implementations?: Array<{
                chain_id: string;
                address: string;
              }>;
            };
          }>;
        };
      };
    };
  };
}

export interface ZerionTransactionResponse {
  data: Array<{
    type: 'transactions';
    id: string;
    attributes: {
      hash: string;
      block_number: number;
      timestamp: string;
      status: 'confirmed' | 'failed' | 'pending';
      fee: {
        value: string;
        price: string;
      };
      transfers: Array<{
        type: 'send' | 'receive';
        quantity: string;
        value: string;
        price: string;
        fungible: {
          name: string;
          symbol: string;
          icon?: {
            url: string;
          };
          implementations?: Array<{
            chain_id: string;
            address: string;
          }>;
        };
        from: string;
        to: string;
      }>;
    };
  }>;
  meta: {
    pagination?: {
      cursor: string;
      has_next: boolean;
    };
  };
}

export interface ZerionNFTResponse {
  data: Array<{
    type: 'nft-positions';
    id: string;
    attributes: {
      quantity: string;
      value?: string;
      price?: string;
      nft: {
        contract_address: string;
        token_id: string;
        name?: string;
        description?: string;
        image?: {
          url: string;
        };
        animation?: {
          url: string;
        };
        collection: {
          name: string;
          slug: string;
        };
        attributes: Array<{
          trait_type: string;
          value: string;
        }>;
      };
    };
  }>;
}

export interface ZerionDeFiResponse {
  data: Array<{
    type: 'defi-positions';
    id: string;
    attributes: {
      value: string;
      quantity: string;
      protocol: {
        name: string;
        slug: string;
        icon?: {
          url: string;
        };
      };
      pool?: {
        name: string;
        type: string;
      };
      yield?: {
        value: string;
        apr: number;
        apy: number;
      };
      locked_until?: string;
      composition: Array<{
        quantity: string;
        value: string;
        fungible: {
          name: string;
          symbol: string;
          icon?: {
            url: string;
          };
        };
      }>;
    };
  }>;
}

// ===============================
// BACKGROUND JOB TYPES
// ===============================

export interface SyncWalletJobData {
  userId: string;
  walletId: string;
  fullSync?: boolean; // If true, sync all data, otherwise just balances
}

export interface UpdatePricesJobData {
  assetIds?: string[]; // If not provided, update all assets
}

export interface CreateSnapshotJobData {
  userId: string;
  walletId?: string; // If not provided, create aggregate snapshot
}

// ===============================
// CACHE KEYS
// ===============================

export enum CacheKeys {
  WALLET_PORTFOLIO = 'crypto:wallet:portfolio',
  WALLET_TRANSACTIONS = 'crypto:wallet:transactions',
  WALLET_NFTS = 'crypto:wallet:nfts',
  WALLET_DEFI = 'crypto:wallet:defi',
  ASSET_PRICES = 'crypto:asset:prices',
  USER_PORTFOLIO = 'crypto:user:portfolio',
  MARKET_DATA = 'crypto:market:data',
}

// ===============================
// ERROR TYPES
// ===============================

export class CryptoServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'CryptoServiceError';
  }
}

export enum CryptoErrorCodes {
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  DUPLICATE_WALLET = 'DUPLICATE_WALLET',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  ZERION_API_ERROR = 'ZERION_API_ERROR',
  SYNC_IN_PROGRESS = 'SYNC_IN_PROGRESS',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  NETWORK_NOT_SUPPORTED = 'NETWORK_NOT_SUPPORTED',
}